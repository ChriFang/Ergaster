/**
 * 每个会话的「输入记录」持久化（localStorage，跨重启保留）。
 *
 * 记录用户在该会话里真正发送过的输入原文（含 "/" 指令原文），供 Composer 按 ↑/↓ 调起。
 * 按 conversationId 独立成键，删除会话时随带清除（见 use-chat-session.handleDeleteConversation）。
 * 纯附件发送（无文字）不记录——记录点只在 handleRunAgent 里 prompt 非空时调用。
 */
const KEY_PREFIX = 'ergaster:input-history:';
/** 每个会话最多保留的输入记录条数。超出从最早侧截断。 */
export const MAX_INPUT_HISTORY = 50;

function keyOf(conversationId: string): string {
  return `${KEY_PREFIX}${conversationId}`;
}

/** 读取某会话的输入记录，按时间顺序返回（最早在前、最新在后），最多 MAX_INPUT_HISTORY 条。 */
export function readInputHistory(conversationId: string): string[] {
  if (!conversationId) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(keyOf(conversationId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string').slice(-MAX_INPUT_HISTORY);
  } catch {
    return [];
  }
}

/**
 * 记录一次发送：追加到末尾。与上一条完全相同则跳过（连续去重），超出上限从最早侧截断。
 * 返回更新后的列表（调用方可忽略）。
 */
export function recordInput(conversationId: string, input: string): string[] {
  const trimmed = input.trim();
  if (!conversationId || !trimmed) {
    return readInputHistory(conversationId);
  }
  const current = readInputHistory(conversationId);
  if (current.length > 0 && current[current.length - 1] === trimmed) {
    return current;
  }
  const next = [...current, trimmed].slice(-MAX_INPUT_HISTORY);
  try {
    window.localStorage.setItem(keyOf(conversationId), JSON.stringify(next));
  } catch {
    // localStorage 不可用时退化为纯内存（本次不落盘），不阻断发送
  }
  return next;
}

/** 删除会话时清除其输入记录。 */
export function clearInputHistory(conversationId: string): void {
  if (!conversationId) {
    return;
  }
  try {
    window.localStorage.removeItem(keyOf(conversationId));
  } catch {
    // localStorage 不可用，忽略
  }
}
