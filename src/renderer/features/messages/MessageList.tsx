import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Bot, Brain, Check, Copy, SquareTerminal, Undo2, User, Users, X } from 'lucide-react';
import type { AttachmentKind } from '../../../shared/attachment';
import type { AgentMessage } from '../../../shared/agent';
import { MessageContent } from './MessageContent';
import { FilePreviewCard } from './FilePreviewCard';
import { ToolInvocationCard } from './ToolInvocationCard';
import { UiFormCard } from './UiFormCard';
import { UiHtmlCard } from './UiHtmlCard';
import { desktopAppClient } from '../../lib/desktop/desktop-app-client';
import {
  computeTurnLastEntryKey,
  getAssistantReasoningText,
  getCollapsedPreviewText,
  getMessageBodyModel,
  getRoleLabel,
  getToolDisplayText,
  groupByTurnUserId,
  groupFilePreviewsByTurnUserId,
  groupMessagesBySubagent,
  hasAssistantReasoning,
  interleaveToolInvocations,
  parseToolMessage,
} from './message-model';
import type { MessageListItem, SubagentGroup } from './message-model';
import type { FilePreviewItem, UiWidgetItem, ToolInvocationItem } from '../../lib/hooks/use-chat-session';

type MessageListProps = {
  messages: AgentMessage[];
  expandedToolMessageKeys: Record<string, boolean>;
  onToggleToolMessage: (messageKey: string) => void;
  onCopyMessage: (text: string) => void;
  /** 从指定消息回退：删除该消息及其后所有内容（按 id 截断）。工作流视图不传则不显示撤销按钮。 */
  onUndoFromMessage?: (messageId: string) => void;
  onMessageContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  /**
   * preview_* 工具推送的瞬时预览卡片，不参与持久化。
   * 按 turnUserId 挂在产生它的那一轮用户消息之后、助手回复之前。
   */
  filePreviews?: FilePreviewItem[];
  /** ui_form 工具推送的瞬时交互表单，挂载规则同 filePreviews。 */
  uiWidgets?: UiWidgetItem[];
  /** run() 工具循环推送的瞬时工具调用卡片，挂载规则同 filePreviews。 */
  toolInvocations?: ToolInvocationItem[];
  /** 表单/HTML 组件提交回调。缺省（如工作流视图）时组件只读展示。 */
  onUiFormSubmit?: (widgetId: string, values: Record<string, unknown>) => void;
  /** HTML 组件弹出独立窗口 / 收回。缺省时不显示弹出按钮。 */
  onUiHtmlPopOut?: (widgetId: string) => void;
  onUiHtmlReclaim?: (widgetId: string) => void;
  /** 是否有会话在执行：用于禁用表单提交（后端单例）。 */
  isRunning?: boolean;
};

function formatAttachmentSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentThumbnail({ storedPath, mimeType, originalName }: { storedPath: string; mimeType: string; originalName: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void desktopAppClient
      .readAttachmentDataUrl(storedPath, mimeType)
      .then((dataUrl) => {
        if (!cancelled) {
          setSrc(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSrc(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [storedPath, mimeType]);

  return (
    <div className="message-attachment-thumbnail">
      {src ? <img src={src} alt={originalName} onError={() => setSrc(null)} /> : null}
    </div>
  );
}

function AttachmentBadge({ kind }: { kind: AttachmentKind }) {
  const label = kind === 'pdf' ? 'PDF' : kind === 'word' ? 'DOC' : kind === 'excel' ? 'XLS' : kind === 'ppt' ? 'PPT' : kind === 'code' ? '</>' : kind === 'image' ? 'IMG' : 'TXT';
  return <span className="message-attachment-kind">{label}</span>;
}

/** 渲染用的扁平条目：子智能体分组展开时，组内消息紧跟在分组头之后。 */
type FlatMessageEntry =
  | { kind: 'message'; nested: boolean; item: MessageListItem }
  | { kind: 'subagent'; group: SubagentGroup; expanded: boolean };

function SubagentBlock({
  group,
  expanded,
  onToggle,
  onMessageContextMenu,
}: {
  group: SubagentGroup;
  expanded: boolean;
  onToggle: () => void;
  onMessageContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const messageCount = group.items.length;

  return (
    <article className="message message-subagent">
      <div className="message-row">
        <div className="message-avatar message-avatar-subagent" aria-hidden="true">
          <Users size={16} strokeWidth={2} />
        </div>
        <div className="message-stack">
          <div className="message-card-shell">
            <div className="message-card-header">
              <div>
                <div className="message-role">{group.role} · {group.label}</div>
                <div className="message-label">
                  子智能体 · 独立上下文 · {group.toolCount} 次工具调用 · {messageCount} 条消息
                </div>
              </div>
              <div className="message-header-actions">
                <button className="message-toggle-button" type="button" aria-expanded={expanded} onClick={onToggle}>
                  {expanded ? '收起' : '展开'}
                </button>
              </div>
            </div>
            {expanded ? null : (
              <div className="message-content message-content-collapsed" onContextMenu={onMessageContextMenu}>
                {group.previewText}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/** 推理内容仍在跟随尾部的判定阈值：距底部小于这个距离就继续自动滚动。 */
const REASONING_FOLLOW_THRESHOLD_PX = 24;

/**
 * 流式推理卡片里实际渲染的字符上限。
 * 思考文本可能长达十几万字，全量塞进 markdown 渲染会在长任务中拖垮 renderer；
 * 状态里仍保留全文，只裁掉展示部分的开头。
 */
const REASONING_DISPLAY_CHAR_LIMIT = 6000;

/**
 * 推理过程卡片。内容限高后在卡片内部滚动，并自动跟随最新输出；
 * 用户往上翻阅时停止跟随，滚回底部附近再恢复。
 */
function ReasoningCard({
  text,
  onContextMenu,
}: {
  text: string;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followTailRef = useRef(true);

  const displayText = text.length > REASONING_DISPLAY_CHAR_LIMIT
    ? `（前 ${text.length - REASONING_DISPLAY_CHAR_LIMIT} 字已省略，仅展示最新部分）\n\n${text.slice(-REASONING_DISPLAY_CHAR_LIMIT)}`
    : text;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !followTailRef.current) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [displayText]);

  function handleScroll() {
    const node = scrollRef.current;
    if (!node) {
      return;
    }

    followTailRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < REASONING_FOLLOW_THRESHOLD_PX;
  }

  return (
    <article className="message message-reasoning-card">
      <div className="message-row">
        <div className="message-avatar message-avatar-reasoning" aria-hidden="true">
          <Brain size={16} strokeWidth={2} />
        </div>
        <div className="message-stack">
          <div className="message-card-shell">
            <div className="message-card-header">
              <div>
                <div className="message-role message-role-reasoning">
                  <Brain size={14} strokeWidth={2} aria-hidden="true" />
                  <span>思考中…</span>
                  <span className="message-reasoning-count">· {text.length} 字</span>
                </div>
                <div className="message-label">模型正在推理，还未开始输出最终内容</div>
              </div>
            </div>
            <div className="message-reasoning-scroll" ref={scrollRef} onScroll={handleScroll}>
              <MessageContent body={{ kind: 'markdown', text: displayText }} onContextMenu={onContextMenu} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export const MessageList = memo(function MessageList({
  messages,
  expandedToolMessageKeys,
  onToggleToolMessage,
  onCopyMessage,
  onUndoFromMessage,
  onMessageContextMenu,
  filePreviews,
  uiWidgets,
  toolInvocations,
  onUiFormSubmit,
  onUiHtmlPopOut,
  onUiHtmlReclaim,
  isRunning,
}: MessageListProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null);
  const [expandedSubagentKeys, setExpandedSubagentKeys] = useState<Record<string, boolean>>({});
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const entries = useMemo(() => {
    const flattened: FlatMessageEntry[] = [];

    for (const entry of groupMessagesBySubagent(messages)) {
      if (entry.kind === 'message') {
        flattened.push({ kind: 'message', nested: false, item: entry });
        continue;
      }

      const expanded = Boolean(expandedSubagentKeys[entry.key]);
      flattened.push({ kind: 'subagent', group: entry, expanded });

      if (expanded) {
        for (const item of entry.items) {
          flattened.push({ kind: 'message', nested: true, item });
        }
      }
    }

    return flattened;
  }, [messages, expandedSubagentKeys]);

  const previewsByTurnUserId = useMemo(() => groupFilePreviewsByTurnUserId(filePreviews ?? []), [filePreviews]);
  const widgetsByTurnUserId = useMemo(() => groupByTurnUserId(uiWidgets ?? []), [uiWidgets]);

  /**
   * 每一轮（turnUserId）在渲染列表里的「最后一个条目 key」。
   * 文件预览/交互组件挂在这个 key 之后，就落在本轮的命令消息与助手回复再往后，
   * 即"在一次对话的最后显示"，不再夹在用户消息和助手回复中间需要往前翻。
   */
  const turnLastEntryKeyByTurnUserId = useMemo(
    () => computeTurnLastEntryKey(
      entries.map((entry) => ({
        key: entry.kind === 'message' ? entry.item.key : entry.group.key,
        // 乐观插入的用户消息（未落盘、无 id）同样标志新一轮开始，终结上一轮的「最后条目」，
        // 否则上一轮的交互组件（表单/HTML）会被拖到本轮推理/回复之后、大卡片盖住新输出
        isUserMessage: entry.kind === 'message' && entry.item.message.role === 'user',
        userMessageId: entry.kind === 'message' && entry.item.message.role === 'user' ? entry.item.message.id : undefined,
      })),
    ),
    [entries],
  );

  /** 反查：条目 key → 应在该条目之后渲染的那一轮 turnUserId（该 key 是这轮的最后条目）。 */
  const turnUserIdByLastEntryKey = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const [turnUserId, entryKey] of turnLastEntryKeyByTurnUserId) {
      byKey.set(entryKey, turnUserId);
    }
    return byKey;
  }, [turnLastEntryKeyByTurnUserId]);

  /** 已渲染成条目、可以就地挂卡片的用户消息 id 集合。 */
  const renderedUserMessageIds = useMemo(() => {
    const ids = new Set<string>();

    for (const entry of entries) {
      if (entry.kind !== 'message') {
        continue;
      }

      const { message } = entry.item;
      if (message.role === 'user' && message.id) {
        ids.add(message.id);
      }
    }

    return ids;
  }, [entries]);

  // 本轮 run 还没结束、消息尚未落盘时，renderer 里那条用户消息是乐观插入的、没有 id，
  // 对不上 turnUserId；被分页挤出视窗的消息同理。这些卡片兜底挂在最后一条用户消息之后，
  // 正好就是"当前用户消息之后、助手回复之前"。
  const fallbackPreviews = useMemo(
    () => (filePreviews ?? []).filter((item) => !item.turnUserId || !renderedUserMessageIds.has(item.turnUserId)),
    [filePreviews, renderedUserMessageIds],
  );

  const fallbackWidgets = useMemo(
    () => (uiWidgets ?? []).filter((item) => !item.turnUserId || !renderedUserMessageIds.has(item.turnUserId)),
    [uiWidgets, renderedUserMessageIds],
  );

  /**
   * 工具调用卡片按调用时序交错进消息流：卡片优先锚定发出 tool_calls 的助手消息，
   * 渲染在该消息之后、下一条消息之前；锚点对不上时（重载后被持久化过滤/乐观消息无 id）
   * 由 interleaveToolInvocations 内部逐级回退（turnUserId → 最后一条用户消息）。
   * 注意只对消息条目做交错（子智能体分组块内不放卡片），因此下标基于这里的 filtered 数组。
   */
  const messageEntries = useMemo(
    () => entries.flatMap((entry) => (entry.kind === 'message' ? [entry] : [])),
    [entries],
  );
  const toolInvocationInterleave = useMemo(
    () => interleaveToolInvocations(messageEntries, toolInvocations ?? []),
    [messageEntries, toolInvocations],
  );
  /** 条目 key → 渲染在该条目之后的工具卡片；用 key 而不是下标，兼容子智能体折叠重排。 */
  const toolInvocationsAfterMessageKey = useMemo(() => {
    const byKey = new Map<string, ToolInvocationItem[]>();
    for (const [index, invocations] of toolInvocationInterleave.invocationsByEntryIndex) {
      const entry = messageEntries[index];
      if (entry) {
        byKey.set(entry.item.key, invocations);
      }
    }
    return byKey;
  }, [messageEntries, toolInvocationInterleave]);
  const trailingToolInvocations = toolInvocationInterleave.unanchored;

  /**
   * 兜底卡片挂载的条目：渲染列表最后一个「消息条目」的 key。
   * run 进行中用户消息还是乐观插入（无 id、对不上 turnUserId）时，预览据此落在列表末尾
   * 而不是夹在中间。末条目是子智能体分组（仅工作流，无预览）或列表为空时返回 null，
   * 由末尾兜底块渲染。
   */
  const fallbackAnchorMessageKey = useMemo(() => {
    const lastEntry = entries[entries.length - 1];
    return lastEntry?.kind === 'message' ? lastEntry.item.key : null;
  }, [entries]);

  function toggleSubagent(groupKey: string) {
    setExpandedSubagentKeys((current) => ({ ...current, [groupKey]: !current[groupKey] }));
  }

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  function handleCopy(messageKey: string, text: string) {
    onCopyMessage(text);
    setCopiedKey(messageKey);
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = setTimeout(() => {
      setCopiedKey((current) => (current === messageKey ? null : current));
      copyResetTimerRef.current = null;
    }, 1500);
  }

  async function handleOpenAttachment(targetPath: string) {
    await window.desktopApp.openPath(targetPath);
  }

  /** 按 kind 分派：表单走 UiFormCard，任意 HTML 走 UiHtmlCard（sandbox iframe）。 */
  function renderUiWidget(widget: UiWidgetItem) {
    const submitDisabled = Boolean(isRunning);
    return widget.kind === 'form' ? (
      <UiFormCard key={widget.id} item={widget} disabled={submitDisabled} onSubmit={(id, values) => onUiFormSubmit?.(id, values)} />
    ) : (
      <UiHtmlCard
        key={widget.id}
        item={widget}
        disabled={submitDisabled}
        poppedOut={widget.poppedOut}
        onSubmit={(id, data) => onUiFormSubmit?.(id, data)}
        onPopOut={(id) => onUiHtmlPopOut?.(id)}
        onReclaim={(id) => onUiHtmlReclaim?.(id)}
      />
    );
  }

  return (
    <>
      <section className="message-list">
        {entries.map((entry) => {
          if (entry.kind === 'subagent') {
            return (
              <div key={entry.group.key} className="message-group">
                <SubagentBlock
                  group={entry.group}
                  expanded={entry.expanded}
                  onToggle={() => toggleSubagent(entry.group.key)}
                  onMessageContextMenu={onMessageContextMenu}
                />
              </div>
            );
          }

          const { message, index } = entry.item;
          const messageKey = entry.item.key;
          // 预览/交互组件挂在"本轮最后一个条目"之后，而不是用户消息之后，
          // 这样它们落在本轮助手回复的后面，是一次对话的末尾。
          const turnOfThisEntry = turnUserIdByLastEntryKey.get(messageKey);
          const turnPreviews = turnOfThisEntry
            ? previewsByTurnUserId.get(turnOfThisEntry) ?? []
            : [];
          // 兜底卡片（对不上任何已渲染用户消息的）统一挂在本轮最后一条用户消息后面
          const inlinePreviews = messageKey === fallbackAnchorMessageKey
            ? [...turnPreviews, ...fallbackPreviews]
            : turnPreviews;
          const turnWidgets = turnOfThisEntry
            ? widgetsByTurnUserId.get(turnOfThisEntry) ?? []
            : [];
          const inlineWidgets = messageKey === fallbackAnchorMessageKey
            ? [...turnWidgets, ...fallbackWidgets]
            : turnWidgets;
          // 时序交错的工具卡片：挂在本条目（锚点助手消息或回退的用户消息）之后
          const inlineToolInvocations = toolInvocationsAfterMessageKey.get(messageKey) ?? [];
          const toolPayload = message.role === 'tool' ? parseToolMessage(message.content) : null;
          const body = getMessageBodyModel(message, toolPayload);
          const displayText = message.role === 'tool' && toolPayload ? getToolDisplayText(toolPayload) : body.text;
          const toolStatusText = toolPayload ? (toolPayload.ok ? '执行成功' : '执行失败') : null;
          const isToolMessage = message.role === 'tool' && toolPayload !== null;
          const isExpanded = isToolMessage ? Boolean(expandedToolMessageKeys[messageKey]) : false;
          const previewText = isToolMessage ? getCollapsedPreviewText(body.text) : '';
          const reasoningText = getAssistantReasoningText(message);
          const hasReasoning = hasAssistantReasoning(message);
          const hasAssistantContentStarted =
            message.role === 'assistant' ? (message.content_started === true || message.content.length > 0) : false;
          const showReasoningBubble = message.role === 'assistant' && hasReasoning && !hasAssistantContentStarted;
          const showAssistantBubble = message.role !== 'assistant' || hasAssistantContentStarted;
          const workflowSubagent = message.workflow?.subagent;
          const workflowActorLabel = workflowSubagent
            // 嵌套在子智能体块里时不再重复角色标签，分组头已经标过了
            ? (entry.nested ? '' : `${message.workflow?.actorRole ?? 'subagent'} · ${workflowSubagent.label}`)
            : message.workflow?.actorId
              ? `${message.workflow.actorId}${message.workflow.phase ? ` · ${message.workflow.phase}` : ''}`
              : '';
          const roleLabel = workflowActorLabel || getRoleLabel(message);
          const showRoleLabel = message.role === 'tool' || Boolean(workflowActorLabel);
          const showMessageHeader = showRoleLabel || Boolean(message.name) || Boolean(toolStatusText) || isToolMessage;
          const toneClass =
            message.role === 'user'
              ? 'message-user'
              : message.role === 'tool'
                ? 'message-tool'
                : 'message-assistant';

          return (
            <div key={messageKey} className={`message-group${entry.nested ? ' message-group-nested' : ''}`}>
              {showReasoningBubble ? (
                <ReasoningCard text={reasoningText} onContextMenu={onMessageContextMenu} />
              ) : null}

              {showAssistantBubble ? (
                <article className={`message ${toneClass} ${toolPayload?.ok === false ? 'message-error' : ''}`}>
                  <div className={`message-row${message.role === 'user' ? ' message-row-user' : ''}`}>
                    {message.role !== 'user' ? (
                      <div className={`message-avatar message-avatar-${message.role}`} aria-hidden="true">
                        {message.role === 'assistant' ? <Bot size={16} strokeWidth={2} /> : <SquareTerminal size={16} strokeWidth={2} />}
                      </div>
                    ) : null}

                    <div className="message-stack">
                      <div className="message-card-shell">
                        {message.id && !isToolMessage && onUndoFromMessage ? (
                          <button
                            className="message-undo-button"
                            type="button"
                            aria-label="撤销该消息及其后内容"
                            title="撤销：删除该消息及其后的所有内容"
                            disabled={isRunning}
                            onClick={() => onUndoFromMessage(message.id!)}
                          >
                            <Undo2 size={14} strokeWidth={2} aria-hidden="true" />
                          </button>
                        ) : null}
                        <button
                          className={`message-copy-button${copiedKey === messageKey ? ' message-copy-button-copied' : ''}`}
                          type="button"
                          aria-label="复制完整消息"
                          title="复制完整消息"
                          onClick={() => handleCopy(messageKey, displayText)}
                        >
                          {copiedKey === messageKey ? <Check size={14} strokeWidth={2.2} aria-hidden="true" /> : <Copy size={14} strokeWidth={2} aria-hidden="true" />}
                        </button>

                        {showMessageHeader ? (
                          <div className="message-card-header">
                            <div>
                              {showRoleLabel ? <div className="message-role">{roleLabel}</div> : null}
                              {message.name ? <div className="message-label">tool: {message.name}</div> : null}
                            </div>
                            <div className="message-header-actions">
                              {toolStatusText ? (
                                <div className={`message-status ${toolPayload?.ok ? 'message-status-success' : 'message-status-error'}`}>
                                  {toolStatusText}
                                </div>
                              ) : null}
                              {isToolMessage ? (
                                <button
                                  className="message-toggle-button"
                                  type="button"
                                  aria-expanded={isExpanded}
                                  onClick={() => onToggleToolMessage(messageKey)}
                                >
                                  {isExpanded ? '收起' : '展开'}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}

                        {toolPayload?.summary ? <div className="message-summary">参数摘要：{toolPayload.summary}</div> : null}

                        {isToolMessage ? (
                          isExpanded ? (
                            <MessageContent body={body} onContextMenu={onMessageContextMenu} />
                          ) : (
                            <div
                              className={`message-content message-content-collapsed${showMessageHeader ? '' : ' message-content-no-header'}`}
                              onContextMenu={onMessageContextMenu}
                            >
                              {previewText}
                            </div>
                          )
                        ) : (
                          <>
                            <MessageContent
                              body={body}
                              onContextMenu={onMessageContextMenu}
                              className={showMessageHeader ? undefined : 'message-content-no-header'}
                            />
                            {message.role === 'user' && message.attachments?.length ? (
                              <div className="message-attachments">
                                {message.attachments.map((attachment) => {
                                  const isImage = attachment.kind === 'image' && Boolean(attachment.storedPath);
                                  const canOpen = Boolean(attachment.storedPath);
                                  return (
                                    <button
                                      key={attachment.id}
                                      type="button"
                                      className={`message-attachment-item${canOpen ? ' message-attachment-item-clickable' : ''}`}
                                      onClick={() => {
                                        if (!attachment.storedPath) {
                                          return;
                                        }
                                        if (isImage) {
                                          void desktopAppClient
                                            .readAttachmentDataUrl(attachment.storedPath, attachment.mimeType)
                                            .then((dataUrl) => {
                                              setPreviewImage({ src: dataUrl, name: attachment.originalName });
                                            });
                                          return;
                                        }
                                        void handleOpenAttachment(attachment.storedPath);
                                      }}
                                      disabled={!canOpen}
                                      title={canOpen ? (isImage ? '点击预览图片' : '点击打开附件') : attachment.originalName}
                                    >
                                      {isImage && attachment.storedPath ? (
                                        <AttachmentThumbnail
                                          storedPath={attachment.storedPath}
                                          mimeType={attachment.mimeType}
                                          originalName={attachment.originalName}
                                        />
                                      ) : null}
                                      <div className="message-attachment-meta">
                                        <div className="message-attachment-title-row">
                                          <AttachmentBadge kind={attachment.kind} />
                                          <span className="message-attachment-name">{attachment.originalName}</span>
                                        </div>
                                        <div className="message-attachment-subtitle">{formatAttachmentSize(attachment.size)}</div>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>

                    {message.role === 'user' ? (
                      <div className="message-avatar message-avatar-user" aria-hidden="true">
                        <User size={16} strokeWidth={2} />
                      </div>
                    ) : null}
                  </div>
                </article>
              ) : null}

              {inlinePreviews.length > 0 ? (
                <div className="file-preview-inline">
                  {inlinePreviews.map((item) => (
                    <FilePreviewCard key={item.id} item={item} onOpenImage={(src, name) => setPreviewImage({ src, name })} />
                  ))}
                </div>
              ) : null}

              {inlineToolInvocations.length > 0 ? (
                <div className="tool-invocation-inline">
                  {inlineToolInvocations.map((item) => (
                    <ToolInvocationCard key={item.id} item={item} />
                  ))}
                </div>
              ) : null}

              {inlineWidgets.length > 0 ? (
                <div className="ui-form-inline">
                  {inlineWidgets.map((widget) => renderUiWidget(widget))}
                </div>
              ) : null}
            </div>
          );
        })}

        {fallbackAnchorMessageKey === null
          ? fallbackPreviews.map((item) => (
            <FilePreviewCard key={item.id} item={item} onOpenImage={(src, name) => setPreviewImage({ src, name })} />
          ))
          : null}

        {trailingToolInvocations.length > 0
          ? trailingToolInvocations.map((item) => (
            <ToolInvocationCard key={item.id} item={item} />
          ))
          : null}

        {fallbackAnchorMessageKey === null
          ? fallbackWidgets.map((widget) => renderUiWidget(widget))
          : null}
      </section>

      {previewImage ? (
        <div className="message-image-preview-overlay" onClick={() => setPreviewImage(null)}>
          <div className="message-image-preview-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="message-image-preview-header">
              <span className="message-image-preview-title">{previewImage.name}</span>
              <button type="button" className="message-image-preview-close" onClick={() => setPreviewImage(null)} aria-label="关闭图片预览">
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <img className="message-image-preview-full" src={previewImage.src} alt={previewImage.name} />
          </div>
        </div>
      ) : null}
    </>
  );
});
