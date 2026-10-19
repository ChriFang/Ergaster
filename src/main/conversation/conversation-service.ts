import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getAppDataRoot } from '../core/app-paths';
import type {
  ConversationChangedEvent,
  ConversationMeta,
  ConversationListItem,
  ConversationMessageCursor,
  ConversationMessagesPage,
  ConversationMessagesPageRequest,
  ConversationOperationResult,
  ConversationUnreadSummary,
} from '../../shared/conversation';
import type { AgentMessage } from '../../shared/agent';
import { createChatCompletion, type ChatCompletionApiMessage } from '../agent/deepseek-client';
import { loadConfig } from '../core/config-service';
import { estimateMessagesTokenCount } from '../core/token-utils';
import { appendMainLog } from '../core/audit-log';
import { DEFAULT_AGENT_ID } from '../../shared/agent-profile';
import { truncateMessagesFromId } from './conversation-truncate';

const META_FILE_NAME = 'meta.json';
const SEGMENTS_DIR_NAME = 'segments';
const SUMMARIZATION_THRESHOLD = 0.65;
const RECENT_MESSAGE_WINDOW = 6;
const STORAGE_VERSION = 2 as const;
const MESSAGE_SEGMENT_MAX_BYTES = 1024 * 1024;
const MAX_MESSAGE_PAGE_SIZE = 100;

const SUMMARIZATION_SYSTEM_PROMPT = `你是一个对话摘要助手。请对以下对话历史进行结构化摘要，保留以下关键信息：

1. **用户目标**：用户在此次对话中的原始目标和意图是什么？
2. **关键决策**：对话中已做出的关键决定和结论。
3. **重要事实**：讨论中涉及的重要事实、数据和上下文。
4. **工具调用**：已执行的工具调用名称及其结果概要（不需要完整输出，只需关键结论）。
5. **待跟进事项**：尚未解决或需要后续跟进的问题。

要求：
- 摘要应简洁但完整，确保后续对话能基于此摘要继续，不丢失关键上下文。
- 使用清晰的分点格式。
- 如果已有先前摘要，请将先前摘要与新对话内容合并为统一摘要，不要丢失先前摘要中的信息。
- 摘要长度建议 200-500 字。`;

function filterMessagesForPersistence(messages: ChatCompletionApiMessage[]): ChatCompletionApiMessage[] {
  return messages.filter((message) => {
    if (message.role === 'tool') {
      return false;
    }
    if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
      return false;
    }
    return true;
  });
}

function toPublicMessages(messages: ChatCompletionApiMessage[]): AgentMessage[] {
  return messages
    .filter((message) => {
      if (message.role !== 'assistant') {
        return true;
      }
      const content = typeof message.content === 'string' ? message.content.trim() : '';
      const hasToolCalls = (message.tool_calls?.length ?? 0) > 0;
      return content.length > 0 || !hasToolCalls;
    })
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: typeof message.content === 'string' ? message.content : '',
      attachments: message.attachments,
      reasoning_content: message.reasoning_content,
      tool_call_id: message.tool_call_id,
      name: message.name,
    }));
}

function normalizeMeta(raw: Partial<ConversationMeta>, directoryPath: string): ConversationMeta {
  const now = new Date().toISOString();
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : path.basename(directoryPath),
    agentId: typeof raw.agentId === 'string' ? raw.agentId.trim() : null,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : '新会话',
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : now,
    messageCount: typeof raw.messageCount === 'number' && Number.isFinite(raw.messageCount) ? Math.max(0, Math.round(raw.messageCount)) : 0,
    tokenEstimate: typeof raw.tokenEstimate === 'number' && Number.isFinite(raw.tokenEstimate) ? Math.max(0, Math.round(raw.tokenEstimate)) : 0,
    summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : null,
    summarizedAt: typeof raw.summarizedAt === 'string' && raw.summarizedAt.trim() ? raw.summarizedAt : null,
    summarizedMessageCount:
      typeof raw.summarizedMessageCount === 'number' && Number.isFinite(raw.summarizedMessageCount)
        ? Math.max(0, Math.round(raw.summarizedMessageCount))
        : 0,
    storageVersion: STORAGE_VERSION,
    segmentCount: typeof raw.segmentCount === 'number' && Number.isFinite(raw.segmentCount) ? Math.max(0, Math.round(raw.segmentCount)) : 0,
    // 旧 meta.json 没有该字段，缺省补 0
    unreadCount: typeof raw.unreadCount === 'number' && Number.isFinite(raw.unreadCount) ? Math.max(0, Math.round(raw.unreadCount)) : 0,
  };
}

function toListItem(meta: ConversationMeta): ConversationListItem {
  return {
    id: meta.id,
    agentId: meta.agentId,
    title: meta.title,
    messageCount: meta.messageCount,
    tokenEstimate: meta.tokenEstimate,
    hasSummary: meta.summary !== null,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    unreadCount: meta.unreadCount,
  };
}

function serializeMessages(messages: ChatCompletionApiMessage[]) {
  return `${JSON.stringify(messages, null, 2)}\n`;
}

function formatCompactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function createSegmentFileName(sequence: number, createdAt: string) {
  return `${String(sequence).padStart(6, '0')}-${createdAt}.json`;
}

function parseSegmentFileName(fileName: string) {
  const match = /^(\d{6})-(\d{8}T\d{6}Z)\.json$/.exec(fileName);
  if (!match) {
    return null;
  }
  return {
    sequence: Number(match[1]),
    createdAt: match[2],
  };
}

type ConversationSegmentMeta = {
  fileName: string;
  filePath: string;
  sequence: number;
  createdAt: string;
  messageCount: number;
  byteSize: number;
};

type ConversationRecord = {
  meta: ConversationMeta;
  directoryName: string;
  directoryPath: string;
  metaFilePath: string;
  segmentsDirPath: string;
  segments: ConversationSegmentMeta[] | null;
};

export class ConversationService {
  private readonly conversationsDir = path.join(getAppDataRoot(), 'conversations');
  private readonly loadedConversations = new Map<string, ConversationRecord>();
  private readonly conversationChangedListeners = new Set<(event: ConversationChangedEvent) => void>();
  private readonly conversationDeletedListeners = new Set<(conversationId: string) => void>();

  getConversationsDirectory(): string {
    return this.conversationsDir;
  }

  /** 订阅主进程主动发起的会话变更（标题后台落定、未读数变化），返回取消订阅函数。 */
  onConversationChanged(listener: (event: ConversationChangedEvent) => void): () => void {
    this.conversationChangedListeners.add(listener);
    return () => {
      this.conversationChangedListeners.delete(listener);
    };
  }

  /** 订阅会话删除，供定时任务等附属数据做级联清理（保持本 service 不反向依赖它们）。 */
  onConversationDeleted(listener: (conversationId: string) => void): () => void {
    this.conversationDeletedListeners.add(listener);
    return () => {
      this.conversationDeletedListeners.delete(listener);
    };
  }

  private emitConversationChanged(event: ConversationChangedEvent): void {
    for (const listener of this.conversationChangedListeners) {
      listener(event);
    }
  }

  private emitConversationDeleted(conversationId: string): void {
    for (const listener of this.conversationDeletedListeners) {
      listener(conversationId);
    }
  }

  getConversationDirectoryPath(conversationId: string): string | null {
    const record = this.loadedConversations.get(conversationId);
    return record?.directoryPath ?? null;
  }

  async scanAndLoadConversations(): Promise<void> {
    await this.ensureDirectory();

    try {
      const entries = await fs.readdir(this.conversationsDir, { withFileTypes: true });
      const directories = entries.filter((entry) => entry.isDirectory());
      const nextConversations = new Map<string, ConversationRecord>();

      for (const dir of directories) {
        const record = await this.loadConversationFromDirectory(path.join(this.conversationsDir, dir.name));
        if (record) {
          nextConversations.set(record.meta.id, record);
        }
      }

      this.loadedConversations.clear();
      for (const [id, record] of nextConversations) {
        this.loadedConversations.set(id, record);
      }

      await appendMainLog('INFO', `Loaded ${this.loadedConversations.size} conversations from ${this.conversationsDir}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to scan conversations directory: ${message}`);
    }
  }

  async reloadConversations(): Promise<void> {
    this.loadedConversations.clear();
    await this.scanAndLoadConversations();
  }

  getConversationListItems(): ConversationListItem[] {
    return Array.from(this.loadedConversations.values())
      .map((record) => toListItem(record.meta))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getConversationsByAgent(agentId: string | null): ConversationListItem[] {
    // 默认智能体实体化后的兼容映射：老会话的 agentId 是 null，新会话写 'default'
    const targetAgentId = agentId ?? DEFAULT_AGENT_ID;
    return this.getConversationListItems().filter((item) =>
      item.agentId === targetAgentId
      || (targetAgentId === DEFAULT_AGENT_ID && item.agentId === null)
    );
  }

  getConversationMeta(id: string): ConversationMeta | null {
    const record = this.loadedConversations.get(id);
    return record ? { ...record.meta } : null;
  }

  async createConversation(agentId: string | null, title?: string): Promise<ConversationMeta> {
    await this.ensureDirectory();

    const scopedAgentId = agentId ?? DEFAULT_AGENT_ID;
    const id = crypto.randomUUID();
    const directoryPath = path.join(this.conversationsDir, id);
    const segmentsDirPath = path.join(directoryPath, SEGMENTS_DIR_NAME);
    const now = new Date().toISOString();

    const meta: ConversationMeta = {
      id,
      agentId: scopedAgentId,
      title: title?.trim() || '新会话',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      tokenEstimate: 0,
      summary: null,
      summarizedAt: null,
      summarizedMessageCount: 0,
      storageVersion: STORAGE_VERSION,
      segmentCount: 0,
      unreadCount: 0,
    };

    await fs.mkdir(directoryPath, { recursive: false });
    await fs.mkdir(segmentsDirPath, { recursive: false });
    await fs.writeFile(path.join(directoryPath, META_FILE_NAME), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

    const record: ConversationRecord = {
      meta,
      directoryName: id,
      directoryPath,
      metaFilePath: path.join(directoryPath, META_FILE_NAME),
      segmentsDirPath,
      segments: [],
    };

    this.loadedConversations.set(id, record);
    await appendMainLog('INFO', `Created conversation: ${id}`);

    return { ...meta };
  }

  async deleteConversation(id: string): Promise<ConversationOperationResult> {
    const record = this.loadedConversations.get(id);
    if (!record) {
      return { ok: false, error: `未找到 ID 为 "${id}" 的会话` };
    }

    try {
      await fs.rm(record.directoryPath, { recursive: true, force: true });
      this.loadedConversations.delete(id);
      await appendMainLog('INFO', `Deleted conversation: ${id}`);
      this.emitConversationDeleted(id);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除会话失败';
      await appendMainLog('ERROR', `Failed to delete conversation ${id}: ${message}`);
      return { ok: false, error: message };
    }
  }

  async deleteConversationsByAgent(agentId: string | null): Promise<number> {
    const items = this.getConversationsByAgent(agentId);
    let deleted = 0;
    for (const item of items) {
      const result = await this.deleteConversation(item.id);
      if (result.ok) {
        deleted += 1;
      }
    }
    return deleted;
  }

  getMessages(_conversationId: string): ChatCompletionApiMessage[] {
    return [];
  }

  async ensureMessagesLoaded(conversationId: string): Promise<ChatCompletionApiMessage[]> {
    return this.getAllMessages(conversationId);
  }

  async getAllMessages(conversationId: string): Promise<ChatCompletionApiMessage[]> {
    const record = this.loadedConversations.get(conversationId);
    if (!record) {
      return [];
    }

    const segments = await this.ensureSegmentsLoaded(conversationId);
    const messages: ChatCompletionApiMessage[] = [];

    for (const segment of segments) {
      const segmentMessages = await this.readSegmentMessages(segment.filePath);
      messages.push(...segmentMessages);
    }

    return filterMessagesForPersistence(messages);
  }

  async getPublicMessagesPage(conversationId: string, request: ConversationMessagesPageRequest): Promise<ConversationMessagesPage> {
    const internalMessages = await this.getMessagesPage(conversationId, request);
    return {
      ...internalMessages,
      messages: toPublicMessages(internalMessages.messages),
    };
  }

  async setMessages(conversationId: string, messages: ChatCompletionApiMessage[]): Promise<void> {
    await this.rewriteSegments(conversationId, messages);
  }

  async appendMessages(conversationId: string, messages: ChatCompletionApiMessage[]): Promise<void> {
    const current = await this.getAllMessages(conversationId);
    await this.rewriteSegments(conversationId, [...current, ...messages]);
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    const record = this.loadedConversations.get(conversationId);
    if (!record) {
      return;
    }

    record.meta.title = title.trim().slice(0, 100) || '新会话';
    record.meta.updatedAt = new Date().toISOString();
    await fs.writeFile(record.metaFilePath, `${JSON.stringify(record.meta, null, 2)}\n`, 'utf8');
    this.emitConversationChanged({
      conversationId,
      title: record.meta.title,
      unreadCount: record.meta.unreadCount,
      messageCount: record.meta.messageCount,
    });
  }

  /** 定时任务把结果追加进会话后累加未读，并推送给 renderer 刷新徽标。 */
  async incrementUnread(conversationId: string, delta = 1): Promise<void> {
    const record = this.loadedConversations.get(conversationId);
    if (!record || delta <= 0) {
      return;
    }

    record.meta.unreadCount += delta;
    await this.persistMeta(record);
    this.emitConversationChanged({
      conversationId,
      title: record.meta.title,
      unreadCount: record.meta.unreadCount,
      messageCount: record.meta.messageCount,
    });
  }

  /** 用户打开会话时清零未读，返回被清掉的条数（0 表示本来就没有未读）。 */
  async clearUnread(conversationId: string): Promise<number> {
    const record = this.loadedConversations.get(conversationId);
    if (!record || record.meta.unreadCount === 0) {
      return 0;
    }

    const cleared = record.meta.unreadCount;
    record.meta.unreadCount = 0;
    await this.persistMeta(record);
    this.emitConversationChanged({
      conversationId,
      title: record.meta.title,
      unreadCount: 0,
      messageCount: record.meta.messageCount,
    });
    return cleared;
  }

  /** 按 scope 聚合未读数：智能体用其 id，代码工程用 code:{projectId}。 */
  getUnreadSummary(): ConversationUnreadSummary {
    const summary: ConversationUnreadSummary = {};
    for (const record of this.loadedConversations.values()) {
      if (record.meta.unreadCount <= 0) {
        continue;
      }
      const scopeKey = record.meta.agentId ?? DEFAULT_AGENT_ID;
      summary[scopeKey] = (summary[scopeKey] ?? 0) + record.meta.unreadCount;
    }
    return summary;
  }

  /**
   * 按消息 id 截断会话：删除该消息及其后所有内容，保留之前的历史。
   * 用于「撤销会话」按钮。rewriteSegments 全量重写会自动维护
   * messageCount/tokenEstimate/updatedAt 与 segments 落盘。
   */
  async truncateToMessage(conversationId: string, messageId: string): Promise<ConversationOperationResult> {
    const record = this.loadedConversations.get(conversationId);
    if (!record) {
      return { ok: false, error: `未找到 ID 为 "${conversationId}" 的会话` };
    }

    const allMessages = await this.getAllMessages(conversationId);
    const truncated = truncateMessagesFromId(allMessages, messageId);
    if (!truncated) {
      return { ok: false, error: '未找到要撤销的消息，会话内容可能已变化。' };
    }

    try {
      await this.setMessages(conversationId, truncated);
      await appendMainLog('INFO', `Truncated conversation ${conversationId} at message ${messageId}, remaining=${truncated.length}`);
      return { ok: true, data: { ...record.meta } };
    } catch (error) {
      const message = error instanceof Error ? error.message : '撤销会话失败';
      await appendMainLog('ERROR', `Failed to truncate conversation ${conversationId}: ${message}`);
      return { ok: false, error: message };
    }
  }

  async resetConversation(conversationId: string): Promise<ConversationOperationResult> {
    const record = this.loadedConversations.get(conversationId);
    if (!record) {
      return { ok: false, error: `未找到 ID 为 "${conversationId}" 的会话` };
    }

    try {
      record.meta = {
        ...record.meta,
        messageCount: 0,
        tokenEstimate: 0,
        summary: null,
        summarizedAt: null,
        summarizedMessageCount: 0,
        updatedAt: new Date().toISOString(),
        storageVersion: STORAGE_VERSION,
        segmentCount: 0,
      };

      await this.replaceSegmentsDirectory(record, []);
      await this.persistMeta(record);
      await appendMainLog('INFO', `Reset conversation: ${conversationId}`);
      return { ok: true, data: { ...record.meta } };
    } catch (error) {
      const message = error instanceof Error ? error.message : '重置会话失败';
      await appendMainLog('ERROR', `Failed to reset conversation ${conversationId}: ${message}`);
      return { ok: false, error: message };
    }
  }

  shouldSummarize(conversationId: string, contextWindowSize: number): boolean {
    const record = this.loadedConversations.get(conversationId);
    if (!record) {
      return false;
    }

    return record.meta.tokenEstimate > SUMMARIZATION_THRESHOLD * contextWindowSize;
  }

  async summarizeConversation(conversationId: string): Promise<boolean> {
    const record = this.loadedConversations.get(conversationId);
    if (!record) {
      return false;
    }

    const allMessages = await this.getAllMessages(conversationId);
    if (allMessages.length <= RECENT_MESSAGE_WINDOW) {
      return false;
    }

    const oldMessages = allMessages.slice(0, -RECENT_MESSAGE_WINDOW);
    const recentMessages = allMessages.slice(-RECENT_MESSAGE_WINDOW);

    try {
      const config = await loadConfig();

      const summarizationMessages: ChatCompletionApiMessage[] = [
        { role: 'system', content: SUMMARIZATION_SYSTEM_PROMPT },
        ...oldMessages,
        { role: 'user', content: '请根据上述对话历史生成结构化摘要。' },
      ];

      const result = await createChatCompletion({
        config,
        messages: summarizationMessages,
        tools: [],
        signal: AbortSignal.timeout(60_000),
      });

      const summary = result.content?.trim();
      if (!summary) {
        await appendMainLog('WARN', `Summarization returned empty for conversation ${conversationId}`);
        return false;
      }

      const summaryMessage: ChatCompletionApiMessage = {
        id: `system-summary-${Date.now()}`,
        role: 'system',
        content: `[对话历史摘要]\n${summary}`,
      };

      record.meta.summary = summary;
      record.meta.summarizedAt = new Date().toISOString();
      record.meta.summarizedMessageCount = oldMessages.length;

      await this.rewriteSegments(conversationId, [summaryMessage, ...recentMessages]);
      await appendMainLog('INFO', `Summarized conversation ${conversationId}: ${oldMessages.length} old messages → summary`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to summarize conversation ${conversationId}: ${message}`);
      return false;
    }
  }

  private async getMessagesPage(
    conversationId: string,
    request: ConversationMessagesPageRequest,
  ): Promise<{ messages: ChatCompletionApiMessage[]; total: number; hasMoreBefore: boolean; nextCursor: ConversationMessageCursor | null }> {
    const record = this.loadedConversations.get(conversationId);
    if (!record) {
      return { messages: [], total: 0, hasMoreBefore: false, nextCursor: null };
    }

    const limit = Math.max(1, Math.min(Math.trunc(request.limit || 20), MAX_MESSAGE_PAGE_SIZE));
    const segments = await this.ensureSegmentsLoaded(conversationId);
    if (segments.length === 0) {
      return { messages: [], total: record.meta.messageCount, hasMoreBefore: false, nextCursor: null };
    }

    let pointerSegmentIndex = request.cursor ? request.cursor.segmentIndex : segments.length - 1;
    let pointerMessageIndex = request.cursor ? request.cursor.messageIndex : Number.POSITIVE_INFINITY;
    let remaining = limit;
    let collected: ChatCompletionApiMessage[] = [];

    while (remaining > 0 && pointerSegmentIndex >= 0) {
      const segment = segments[pointerSegmentIndex];
      const segmentMessages = await this.readSegmentMessages(segment.filePath);
      if (segmentMessages.length === 0) {
        pointerSegmentIndex -= 1;
        pointerMessageIndex = Number.POSITIVE_INFINITY;
        continue;
      }

      const resolvedMessageIndex = Number.isFinite(pointerMessageIndex)
        ? Math.min(Math.max(Math.trunc(pointerMessageIndex), 0), segmentMessages.length - 1)
        : segmentMessages.length - 1;

      if (resolvedMessageIndex < 0) {
        pointerSegmentIndex -= 1;
        pointerMessageIndex = Number.POSITIVE_INFINITY;
        continue;
      }

      const takeCount = Math.min(remaining, resolvedMessageIndex + 1);
      const startIndex = resolvedMessageIndex - takeCount + 1;
      const chunk = segmentMessages.slice(startIndex, resolvedMessageIndex + 1);
      collected = [...chunk, ...collected];
      remaining -= chunk.length;

      if (startIndex > 0) {
        pointerMessageIndex = startIndex - 1;
      } else {
        pointerSegmentIndex -= 1;
        pointerMessageIndex = Number.POSITIVE_INFINITY;
      }
    }

    let nextCursor: ConversationMessageCursor | null = null;
    if (pointerSegmentIndex >= 0) {
      const previousSegmentMessages = await this.readSegmentMessages(segments[pointerSegmentIndex].filePath);
      const resolvedMessageIndex = Number.isFinite(pointerMessageIndex)
        ? Math.min(Math.max(Math.trunc(pointerMessageIndex), 0), previousSegmentMessages.length - 1)
        : previousSegmentMessages.length - 1;
      if (resolvedMessageIndex >= 0 && previousSegmentMessages.length > 0) {
        nextCursor = {
          segmentIndex: pointerSegmentIndex,
          messageIndex: resolvedMessageIndex,
        };
      }
    }

    return {
      messages: collected,
      total: record.meta.messageCount,
      hasMoreBefore: nextCursor !== null,
      nextCursor,
    };
  }

  private async rewriteSegments(conversationId: string, messages: ChatCompletionApiMessage[]): Promise<void> {
    const record = this.loadedConversations.get(conversationId);
    if (!record) {
      return;
    }

    const persistedMessages = filterMessagesForPersistence(messages);
    const tokenEstimate = estimateMessagesTokenCount(persistedMessages);
    const now = new Date().toISOString();
    const timestamp = formatCompactTimestamp(new Date(now));
    const segmentPayloads = this.splitMessagesIntoSegments(persistedMessages, timestamp);

    await this.replaceSegmentsDirectory(record, segmentPayloads);

    record.meta = {
      ...record.meta,
      updatedAt: now,
      messageCount: persistedMessages.length,
      tokenEstimate,
      storageVersion: STORAGE_VERSION,
      segmentCount: segmentPayloads.length,
    };

    await this.persistMeta(record);
  }

  private splitMessagesIntoSegments(messages: ChatCompletionApiMessage[], timestamp: string) {
    const segments: Array<{ fileName: string; content: string; messageCount: number; byteSize: number }> = [];
    let currentSegmentMessages: ChatCompletionApiMessage[] = [];

    const flushCurrentSegment = () => {
      if (currentSegmentMessages.length === 0) {
        return;
      }
      const content = serializeMessages(currentSegmentMessages);
      const sequence = segments.length + 1;
      segments.push({
        fileName: createSegmentFileName(sequence, timestamp),
        content,
        messageCount: currentSegmentMessages.length,
        byteSize: Buffer.byteLength(content, 'utf8'),
      });
      currentSegmentMessages = [];
    };

    for (const message of messages) {
      if (currentSegmentMessages.length === 0) {
        currentSegmentMessages.push(message);
        continue;
      }

      const nextMessages = [...currentSegmentMessages, message];
      const nextByteSize = Buffer.byteLength(serializeMessages(nextMessages), 'utf8');
      if (nextByteSize > MESSAGE_SEGMENT_MAX_BYTES) {
        flushCurrentSegment();
        currentSegmentMessages.push(message);
      } else {
        currentSegmentMessages = nextMessages;
      }
    }

    flushCurrentSegment();
    return segments;
  }

  private async replaceSegmentsDirectory(
    record: ConversationRecord,
    segments: Array<{ fileName: string; content: string; messageCount: number; byteSize: number }>,
  ) {
    const tempDirPath = path.join(record.directoryPath, `${SEGMENTS_DIR_NAME}.tmp-${Date.now()}`);
    await fs.rm(tempDirPath, { recursive: true, force: true });
    await fs.mkdir(tempDirPath, { recursive: true });

    for (const segment of segments) {
      await fs.writeFile(path.join(tempDirPath, segment.fileName), segment.content, 'utf8');
    }

    await fs.rm(record.segmentsDirPath, { recursive: true, force: true });
    await fs.rename(tempDirPath, record.segmentsDirPath);

    record.segments = segments.map((segment, index) => {
      const parsed = parseSegmentFileName(segment.fileName);
      return {
        fileName: segment.fileName,
        filePath: path.join(record.segmentsDirPath, segment.fileName),
        sequence: parsed?.sequence ?? index + 1,
        createdAt: parsed?.createdAt ?? formatCompactTimestamp(),
        messageCount: segment.messageCount,
        byteSize: segment.byteSize,
      };
    });
  }

  private async persistMeta(record: ConversationRecord) {
    await fs.writeFile(record.metaFilePath, `${JSON.stringify(record.meta, null, 2)}\n`, 'utf8');
  }

  private async ensureSegmentsLoaded(conversationId: string): Promise<ConversationSegmentMeta[]> {
    const record = this.loadedConversations.get(conversationId);
    if (!record) {
      return [];
    }

    if (record.segments !== null) {
      return [...record.segments];
    }

    await fs.mkdir(record.segmentsDirPath, { recursive: true });

    try {
      const entries = await fs.readdir(record.segmentsDirPath, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

      const segments: ConversationSegmentMeta[] = [];
      for (const fileName of files) {
        const parsed = parseSegmentFileName(fileName);
        if (!parsed) {
          await appendMainLog('ERROR', `Ignored invalid conversation segment file: ${fileName}`);
          continue;
        }
        const filePath = path.join(record.segmentsDirPath, fileName);
        const [stat, messages] = await Promise.all([fs.stat(filePath), this.readSegmentMessages(filePath)]);
        segments.push({
          fileName,
          filePath,
          sequence: parsed.sequence,
          createdAt: parsed.createdAt,
          messageCount: messages.length,
          byteSize: stat.size,
        });
      }

      record.segments = segments;
      return [...segments];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to load segments for conversation ${conversationId}: ${message}`);
      record.segments = [];
      return [];
    }
  }

  private async readSegmentMessages(filePath: string): Promise<ChatCompletionApiMessage[]> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return filterMessagesForPersistence(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to read conversation segment ${filePath}: ${message}`);
      return [];
    }
  }

  private async ensureDirectory() {
    await fs.mkdir(this.conversationsDir, { recursive: true });
  }

  private async loadConversationFromDirectory(directoryPath: string): Promise<ConversationRecord | null> {
    const metaFilePath = path.join(directoryPath, META_FILE_NAME);
    const segmentsDirPath = path.join(directoryPath, SEGMENTS_DIR_NAME);

    try {
      const raw = await fs.readFile(metaFilePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ConversationMeta>;
      const meta = normalizeMeta(parsed, directoryPath);

      return {
        meta,
        directoryName: path.basename(directoryPath),
        directoryPath,
        metaFilePath,
        segmentsDirPath,
        segments: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to load conversation from ${directoryPath}: ${message}`);
      return null;
    }
  }
}

export const conversationService = new ConversationService();
