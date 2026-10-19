import type { AgentMessage, AgentStreamEvent, FilePreviewPayload, ToolInvocationPayload } from '../../../shared/agent';
import type { ConversationMessageCursor } from '../../../shared/conversation';
import type { ToolConfirmationRequest } from '../../../shared/tools';
import type { UiWidgetPayload } from '../../../shared/ui-form';
import { getFilePreviewKey } from '../../features/messages/message-model';
import { appendAssistantStreamDelta } from './agent-stream';

/** 内存保留的会话桶上限。超出时淘汰最久未用、且非运行中的桶（切回时重载）。 */
export const MAX_SESSION_BUCKETS = 5;

/** 会话区瞬时文件预览卡片。只存在于当前渲染周期，不持久化，重开应用后消失。 */
export type FilePreviewItem = FilePreviewPayload & { id: string };

/** 会话区瞬时交互组件（ui_form / render_ui）。同样不持久化；submitted 标记提交后锁定，避免重复触发多轮。poppedOut 标记已弹出到独立窗口（内联降级为占位）。 */
export type UiWidgetItem = UiWidgetPayload & { id: string; submitted: boolean; poppedOut: boolean };
/** 表单 widget（kind:'form'）的窄化条目。 */
export type UiFormWidgetItem = Extract<UiWidgetItem, { kind: 'form' }>;
/** HTML widget（kind:'html'）的窄化条目。 */
export type UiHtmlWidgetItem = Extract<UiWidgetItem, { kind: 'html' }>;

/** 会话区瞬时工具调用卡片。同样不持久化；按 toolCallId 从"执行中"原地更新为成功/失败。 */
export type ToolInvocationItem = ToolInvocationPayload & { id: string };

/** 单个会话的运行时视图状态（每个 conversationId 一份）。 */
export type SessionState = {
  messages: AgentMessage[];
  messagesPageCursor: ConversationMessageCursor | null;
  hasMoreMessagesBefore: boolean;
  isRunning: boolean;
  /**
   * 最近一次收到「可见流式增量」（content / reasoning delta）的时间戳（epoch ms），无则 0。
   * "正在执行"面板据此判定空闲：运行中且距上次可见增量超过阈值就显示，覆盖工具参数流式、
   * 工具执行、换轮等待等所有静默窗口——不依赖对具体阶段的精确信令，避免模型（如 Grok）
   * 先输出旁白再调工具时那段静默看似卡死。正在吐字时增量不断刷新它，面板自然让位给文字。
   */
  lastStreamAt: number;
  runStatus: string;
  lastError: string | null;
  confirmationRequest: ToolConfirmationRequest | null;
  filePreviews: FilePreviewItem[];
  uiWidgets: UiWidgetItem[];
  toolInvocations: ToolInvocationItem[];
  expandedToolMessageKeys: Record<string, boolean>;
  /** 流式 delta 合并缓冲：按时间片合并后再刷入 messages，避免逐条 setState 压垮 renderer。 */
  pendingStreamEvents: AgentStreamEvent[];
};

/** 会话桶集合 + LRU 访问顺序（order 末尾为最近使用）。 */
export type SessionStore = {
  sessions: Record<string, SessionState>;
  order: string[];
};

export function createEmptySession(): SessionState {
  return {
    messages: [],
    messagesPageCursor: null,
    hasMoreMessagesBefore: false,
    isRunning: false,
    lastStreamAt: 0,
    runStatus: '',
    lastError: null,
    confirmationRequest: null,
    filePreviews: [],
    uiWidgets: [],
    toolInvocations: [],
    expandedToolMessageKeys: {},
    pendingStreamEvents: [],
  };
}

export function createEmptyStore(): SessionStore {
  return { sessions: {}, order: [] };
}

export function getSession(store: SessionStore, id: string | null): SessionState | null {
  if (!id) {
    return null;
  }
  return store.sessions[id] ?? null;
}

/** 把 id 标记为最近使用（移到 order 末尾）。 */
function touchOrder(order: string[], id: string): string[] {
  return [...order.filter((item) => item !== id), id];
}

/** 是否有任一会话处于运行中（后端单例，用于跨会话发送/取消判断）。 */
export function hasAnyRunning(store: SessionStore): boolean {
  return Object.values(store.sessions).some((session) => session.isRunning);
}

/**
 * 确保某会话有桶，并把它标记为最近使用；同时执行 LRU 淘汰。
 * 淘汰规则：超过上限时，从最久未用侧丢弃「非运行中」的桶；运行中的桶永不淘汰。
 */
export function ensureSession(store: SessionStore, id: string): SessionStore {
  const sessions = store.sessions[id]
    ? store.sessions
    : { ...store.sessions, [id]: createEmptySession() };
  let order = touchOrder(store.order, id);

  if (order.length > MAX_SESSION_BUCKETS) {
    const nextSessions = { ...sessions };
    const kept: string[] = [];
    // order 头部为最久未用。从头扫描淘汰非运行中的桶，直到数量达标
    let overflow = order.length - MAX_SESSION_BUCKETS;
    for (const candidate of order) {
      if (overflow > 0 && candidate !== id && !nextSessions[candidate]?.isRunning) {
        delete nextSessions[candidate];
        overflow -= 1;
        continue;
      }
      kept.push(candidate);
    }
    return { sessions: nextSessions, order: kept };
  }

  return { sessions, order };
}

/** 用 patch 更新指定会话桶（浅合并）。桶不存在时先建。不改动 LRU 顺序。 */
export function updateSession(
  store: SessionStore,
  id: string,
  patch: Partial<SessionState> | ((prev: SessionState) => Partial<SessionState>),
): SessionStore {
  const prev = store.sessions[id] ?? createEmptySession();
  const resolved = typeof patch === 'function' ? patch(prev) : patch;
  return {
    sessions: { ...store.sessions, [id]: { ...prev, ...resolved } },
    order: store.order.includes(id) ? store.order : [...store.order, id],
  };
}

/** 删除某会话桶（会话被删除时调用）。 */
export function removeSession(store: SessionStore, id: string): SessionStore {
  if (!store.sessions[id]) {
    return store;
  }
  const nextSessions = { ...store.sessions };
  delete nextSessions[id];
  return { sessions: nextSessions, order: store.order.filter((item) => item !== id) };
}

/**
 * 把一条流式 delta 事件累积进对应会话桶的缓冲。done 事件不进缓冲（由 flush 处理边界）。
 * 该函数只做「累积到 pendingStreamEvents」，真正合并进 messages 由 flushSession 完成。
 */
export function bufferStreamEvent(store: SessionStore, id: string, event: AgentStreamEvent): SessionStore {
  return updateSession(store, id, (prev) => ({
    pendingStreamEvents: [...prev.pendingStreamEvents, event],
  }));
}

/** 冲刷某会话桶的流缓冲：把缓冲里的 delta 依次合并进 messages，并清空缓冲。 */
export function flushSession(store: SessionStore, id: string): SessionStore {
  const prev = store.sessions[id];
  if (!prev || prev.pendingStreamEvents.length === 0) {
    return store;
  }
  let messages = prev.messages;
  for (const event of prev.pendingStreamEvents) {
    messages = appendAssistantStreamDelta(messages, event);
  }
  return updateSession(store, id, { messages, pendingStreamEvents: [] });
}

/** 向某会话桶追加一张文件预览卡片；同一 key 视为同一张卡片，替换而非追加。 */
export function appendFilePreviewToSession(store: SessionStore, id: string, payload: FilePreviewPayload): SessionStore {
  const key = getFilePreviewKey(payload);
  return updateSession(store, id, (prev) => ({
    filePreviews: [...prev.filePreviews.filter((item) => getFilePreviewKey(item) !== key), { ...payload, id: key }],
  }));
}

/** 向某会话桶追加一个交互组件；widgetId 已存在则忽略（同一 widget 只渲染一次）。 */
export function appendUiWidgetToSession(store: SessionStore, id: string, payload: UiWidgetPayload): SessionStore {
  return updateSession(store, id, (prev) => {
    if (prev.uiWidgets.some((item) => item.widgetId === payload.widgetId)) {
      return {};
    }
    return { uiWidgets: [...prev.uiWidgets, { ...payload, id: payload.widgetId, submitted: false, poppedOut: false }] };
  });
}

/** 向某会话桶 upsert 一条工具调用：toolCallId 已存在则合并更新（执行中→终态），否则追加。 */
export function upsertToolInvocationToSession(store: SessionStore, id: string, payload: ToolInvocationPayload): SessionStore {
  return updateSession(store, id, (prev) => {
    const existingIndex = prev.toolInvocations.findIndex((item) => item.toolCallId === payload.toolCallId);
    if (existingIndex === -1) {
      return { toolInvocations: [...prev.toolInvocations, { ...payload, id: payload.toolCallId }] };
    }
    const next = [...prev.toolInvocations];
    // 合并而非替换：终态事件不再重发 argsSummary，需保留 running 时的摘要
    next[existingIndex] = { ...next[existingIndex], ...payload, id: next[existingIndex].id };
    return { toolInvocations: next };
  });
}

/**
 * 撤销（截断历史）后清理瞬时卡片：只保留 turnUserId 仍存在于给定用户消息 id 集合中的卡片。
 * 工具调用 / 文件预览 / 交互组件都按 turnUserId 归属某一轮；被撤销的轮次其用户消息已从会话移除，
 * 对应卡片必须一并清除——否则再次发送后会被 MessageList 的兜底锚定逻辑重新挂到残留消息上而"复活"。
 * 缺 turnUserId 的卡片（异常路径）无法归属某一轮，撤销时一并清除。
 */
export function pruneTransientCardsToTurns(store: SessionStore, id: string, survivingTurnUserIds: Set<string>): SessionStore {
  const keep = (item: { turnUserId?: string }) =>
    item.turnUserId !== undefined && survivingTurnUserIds.has(item.turnUserId);
  return updateSession(store, id, (prev) => ({
    toolInvocations: prev.toolInvocations.filter(keep),
    filePreviews: prev.filePreviews.filter(keep),
    uiWidgets: prev.uiWidgets.filter(keep),
  }));
}

/** 把某交互组件标记为已提交（锁定，避免用户反复点触发多轮）。 */
export function markUiWidgetSubmitted(store: SessionStore, id: string, widgetId: string): SessionStore {
  return updateSession(store, id, (prev) => ({
    uiWidgets: prev.uiWidgets.map((item) => (item.widgetId === widgetId ? { ...item, submitted: true } : item)),
  }));
}

/** 标记某交互组件是否已弹出到独立窗口：弹出后内联降级为占位，关闭后恢复。 */
export function markUiWidgetPoppedOut(store: SessionStore, id: string, widgetId: string, poppedOut: boolean): SessionStore {
  return updateSession(store, id, (prev) => ({
    uiWidgets: prev.uiWidgets.map((item) => (item.widgetId === widgetId ? { ...item, poppedOut } : item)),
  }));
}

