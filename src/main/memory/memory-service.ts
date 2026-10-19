import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getMemoryRoot } from '../core/app-paths';
import { appendMainLog, appendMemoryAuditLog } from '../core/audit-log';
import { loadConfig } from '../core/config-service';
import { createChatCompletion } from '../agent/deepseek-client';
import type { MemoryAddInput, MemoryAuditSource, MemoryEntry, MemoryOperationResult } from '../../shared/memory';
import {
  MEMORY_CONTENT_MAX_LENGTH,
  MEMORY_EXTRACTION_SYSTEM_PROMPT,
  buildMemoryBlock,
  classifyTurn,
  isNearDuplicate,
  parseExtractedMemories,
  rankEntriesForPrompt,
} from './memory-text-utils';

const INJECT_LIMIT = 8;
const MAX_ENTRIES = 200;
const EXTRACT_EVERY_N_TURNS = 4;
/** 启动清理:非置顶、从未被检索命中（useCount=0）且创建超过这么多天的条目视为噪音，自动清除。 */
const PRUNE_UNUSED_AFTER_DAYS = 30;
const errText = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error');

/** 全局长期记忆服务（单例）。单文件落盘，内存态与磁盘态保持一致。 */
class MemoryService {
  private entries: MemoryEntry[] = [];
  private readonly memoryDir = getMemoryRoot();
  private readonly memoryFile = path.join(this.memoryDir, 'memory.json');
  /** 按会话的抽取节流计数。仅内存态，重启清零可接受。 */
  private readonly turnCounters = new Map<string, number>();

  async scanAndLoad(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.memoryFile, 'utf8'));
      this.entries = Array.isArray(parsed) ? parsed : [];
      await appendMainLog('INFO', `Loaded ${this.entries.length} memory entries`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await appendMainLog('ERROR', `Failed to load memory store: ${errText(error)}`);
      }
      this.entries = [];
    }
    await this.pruneStale();
  }

  list(): MemoryEntry[] {
    return [...this.entries];
  }

  search(query: string, limit = INJECT_LIMIT): MemoryEntry[] {
    return rankEntriesForPrompt(this.entries, query, limit);
  }

  /** 每轮注入用：检索 + 累加使用统计（不阻塞主链路）。 */
  async getPromptBlock(query: string): Promise<string> {
    const top = this.search(query, INJECT_LIMIT);
    if (top.length === 0) {
      return '';
    }
    const now = new Date().toISOString();
    for (const entry of top) {
      entry.lastUsedAt = now;
      entry.useCount += 1;
    }
    void this.persist();
    return buildMemoryBlock(top);
  }

  async add(input: MemoryAddInput, source: MemoryAuditSource = 'tool'): Promise<MemoryOperationResult> {
    const content = input.content.trim().slice(0, MEMORY_CONTENT_MAX_LENGTH);
    if (!content) {
      return { ok: false, error: '记忆内容为空。' };
    }
    if (isNearDuplicate(content, this.entries)) {
      await appendMemoryAuditLog({ op: 'dedup_skip', source, content, reason: '与已有记忆近重复' });
      return { ok: false, error: '与已有记忆重复，未新增。' };
    }
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      kind: input.kind ?? 'fact',
      content,
      pinned: Boolean(input.pinned),
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      useCount: 0,
      sourceConversationId: input.sourceConversationId ?? null,
    };
    this.entries.push(entry);
    this.evictIfNeeded();
    await this.persist();
    await appendMemoryAuditLog({ op: 'add', source, id: entry.id, kind: entry.kind, content: entry.content });
    return { ok: true, data: entry };
  }

  async forget(id: string): Promise<MemoryOperationResult> {
    const target = this.entries.find((entry) => entry.id === id);
    if (!target) {
      return { ok: false, error: '未找到该记忆。' };
    }
    this.entries = this.entries.filter((entry) => entry.id !== id);
    await this.persist();
    // 记录被删内容，便于无 UI 时手工找回
    await appendMemoryAuditLog({ op: 'forget', source: 'tool', id: target.id, kind: target.kind, content: target.content });
    return { ok: true };
  }

  /** fire-and-forget：一轮结束后按节流抽取事实并入库，绝不把异常抛回主链路。 */
  async maybeExtractAndStore(input: {
    conversationId: string;
    userText: string;
    recentMessages: Array<{ role: string; content: unknown }>;
  }): Promise<void> {
    if (!this.shouldExtract(input.conversationId, input.userText)) {
      return;
    }
    try {
      // 只取用户本人的发言:关于用户的持久事实来自用户说的话,助手对任务的描述是主要噪音源。
      const transcript = input.recentMessages
        .filter((message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim())
        .map((message) => `用户:${(message.content as string).trim()}`)
        .join('\n');
      if (!transcript) {
        return;
      }
      const config = await loadConfig();
      const result = await createChatCompletion({
        config,
        tools: [],
        signal: AbortSignal.timeout(30_000),
        messages: [
          { role: 'system', content: MEMORY_EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: transcript },
        ],
      });
      const extracted = parseExtractedMemories(result.content ?? '');
      let stored = 0;
      for (const item of extracted) {
        const outcome = await this.add({ kind: item.kind, content: item.content, sourceConversationId: input.conversationId }, 'auto');
        if (outcome.ok) {
          stored += 1;
        }
      }
      // 始终记录一次抽取尝试（含命中 0 条），让审计能确认抽取确实跑过，而不是被节流跳过。
      await appendMemoryAuditLog({ op: 'extract', source: 'auto', reason: `命中 ${extracted.length} 条，入库 ${stored} 条` });
    } catch (error) {
      await appendMainLog('WARN', `Memory extraction failed: ${errText(error)}`);
    }
  }

  /** 只有“实质轮次”才推进计数；每 N 个实质轮次才真正抽一次（详见 classifyTurn）。 */
  private shouldExtract(conversationId: string, userText: string): boolean {
    const decision = classifyTurn(userText);
    if (decision === 'skip') {
      return false;
    }
    if (decision === 'now') {
      this.turnCounters.set(conversationId, 0);
      return true;
    }
    const next = (this.turnCounters.get(conversationId) ?? 0) + 1;
    if (next < EXTRACT_EVERY_N_TURNS) {
      this.turnCounters.set(conversationId, next);
      return false;
    }
    this.turnCounters.set(conversationId, 0);
    return true;
  }

  /** 启动时清理长期未使用的噪音条目：非置顶、useCount=0 且创建超过阈值天数者删除，并写审计以便找回。 */
  private async pruneStale(): Promise<void> {
    const cutoff = Date.now() - PRUNE_UNUSED_AFTER_DAYS * 24 * 60 * 60 * 1000;
    const kept: MemoryEntry[] = [];
    const removed: MemoryEntry[] = [];
    for (const entry of this.entries) {
      const created = Date.parse(entry.createdAt) || 0;
      if (entry.pinned || entry.useCount > 0 || created > cutoff) {
        kept.push(entry);
      } else {
        removed.push(entry);
      }
    }
    if (removed.length === 0) {
      return;
    }
    this.entries = kept;
    await this.persist();
    for (const entry of removed) {
      await appendMemoryAuditLog({
        op: 'forget',
        source: 'auto',
        id: entry.id,
        kind: entry.kind,
        content: entry.content,
        reason: `长期未使用自动清理（>${PRUNE_UNUSED_AFTER_DAYS}天且从未命中）`,
      });
    }
    await appendMainLog('INFO', `Pruned ${removed.length} stale memory entries`);
  }

  /** 超上限时淘汰非 pinned、最久未使用者。 */
  private evictIfNeeded(): void {
    if (this.entries.length <= MAX_ENTRIES) {
      return;
    }
    const removable = this.entries
      .filter((entry) => !entry.pinned)
      .sort((a, b) => (Date.parse(a.lastUsedAt ?? a.updatedAt) || 0) - (Date.parse(b.lastUsedAt ?? b.updatedAt) || 0));
    const victims = new Set(removable.slice(0, this.entries.length - MAX_ENTRIES).map((entry) => entry.id));
    this.entries = this.entries.filter((entry) => !victims.has(entry.id));
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
    await fs.writeFile(this.memoryFile, `${JSON.stringify(this.entries, null, 2)}\n`, 'utf8');
  }
}

export const memoryService = new MemoryService();
