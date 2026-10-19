import { codeConversationScopePrefix } from '../../../shared/code-project';

/**
 * 上次激活的会话引用，用于重启后恢复到用户离开时的会话（而非固定回到默认智能体）。
 *
 * 仅是 UI 视图偏好，存 renderer 的 localStorage 即可，不进主进程领域数据。
 * scope 复用 conversation.agentId 的取值约定：
 * - 智能体：agentId，默认智能体为 null
 * - 代码工程：code:{projectId}
 */
export type LastActiveSession = {
  scope: string | null;
  conversationId: string;
};

const STORAGE_KEY = 'ergaster.last-active-session';

export function readLastActiveSession(): LastActiveSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LastActiveSession>;
    if (typeof parsed?.conversationId !== 'string' || !parsed.conversationId) {
      return null;
    }
    const scope = typeof parsed.scope === 'string' ? parsed.scope : null;
    return { scope, conversationId: parsed.conversationId };
  } catch {
    return null;
  }
}

export function writeLastActiveSession(session: LastActiveSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage 不可用（隐私模式/配额）时静默降级：恢复功能失效但不影响主流程
  }
}

export function clearLastActiveSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上，忽略
  }
}

/** scope 是否指向代码工程；是则返回其 projectId，否返回 null。 */
export function parseCodeProjectIdFromScope(scope: string | null): string | null {
  if (scope && scope.startsWith(codeConversationScopePrefix)) {
    return scope.slice(codeConversationScopePrefix.length);
  }
  return null;
}
