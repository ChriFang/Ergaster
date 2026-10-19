import { useEffect, useRef } from 'react';
import type { PendingAttachment } from './use-chat-session';

/** 单个会话暂存的未发送内容：输入文字 + 待发送附件。 */
type ConversationDraft = { input: string; attachments: PendingAttachment[] };

/**
 * 会话级草稿：未发送的输入文字与待发送附件按 conversationId 隔离。
 *
 * Composer 的 input（useComposerState）与 attachments（useChatSession）都是跨会话共享的单一状态，
 * 切换会话不会自动换草稿，于是"在 A 里打了字/加了附件没发、切到 B 还在"。这里在激活会话变化时：
 * 先把当前草稿（文字 + 附件）暂存到切走的那个会话，再载入目标会话的草稿（无则清空）。
 * 仅内存态（不跨重启）；会话删除后其草稿条目自然失效（UUID 不复用，不主动清理）。
 */
export function useConversationDrafts(params: {
  activeConversationId: string | null;
  input: string;
  setInput: (value: string) => void;
  attachments: PendingAttachment[];
  setAttachments: (attachments: PendingAttachment[]) => void;
}) {
  const { activeConversationId, input, setInput, attachments, setAttachments } = params;
  const draftsRef = useRef<Map<string, ConversationDraft>>(new Map());
  // 用 ref 持有最新值：effect 只依赖 activeConversationId，切走那一刻读到的仍是原会话的草稿
  const inputRef = useRef(input);
  inputRef.current = input;
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const prevConversationIdRef = useRef<string | null>(activeConversationId);

  useEffect(() => {
    const prev = prevConversationIdRef.current;
    if (prev === activeConversationId) {
      return;
    }
    // 此刻 input/attachments 仍是切走前那个会话的内容（尚未被下面重置），暂存起来
    if (prev !== null) {
      draftsRef.current.set(prev, { input: inputRef.current, attachments: attachmentsRef.current });
    }
    const draft = activeConversationId ? draftsRef.current.get(activeConversationId) : undefined;
    setInput(draft?.input ?? '');
    setAttachments(draft?.attachments ?? []);
    prevConversationIdRef.current = activeConversationId;
  }, [activeConversationId, setInput, setAttachments]);
}
