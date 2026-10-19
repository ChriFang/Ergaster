import { useState } from 'react';
import { Loader2, SquareTerminal } from 'lucide-react';
import type { ToolInvocationItem } from '../../lib/hooks/use-chat-session';
import { getCollapsedPreviewText, getToolDisplayText, parseToolMessage } from './message-model';
import { MessageContent } from './MessageContent';

type ToolInvocationCardProps = {
  item: ToolInvocationItem;
};

function getStatusLabel(item: ToolInvocationItem) {
  if (item.status === 'running') {
    return '执行中';
  }
  return item.status === 'error' ? '执行失败' : '执行成功';
}

/** 会话区瞬时工具调用卡片：由 run() 工具循环推送，不进消息历史、不落盘。 */
export function ToolInvocationCard({ item }: ToolInvocationCardProps) {
  const [expanded, setExpanded] = useState(false);

  const payload = item.resultContent ? parseToolMessage(item.resultContent) : null;
  const resultText = payload ? getToolDisplayText(payload) : item.resultContent ?? '';
  const previewText = resultText ? getCollapsedPreviewText(resultText) : '';
  const isRunning = item.status === 'running';
  const statusClass = item.status === 'error' ? 'message-status-error' : 'message-status-success';

  return (
    <article className={`message message-tool tool-invocation-card${item.ok === false ? ' message-error' : ''}`}>
      <div className="message-row">
        <div className="message-avatar message-avatar-tool" aria-hidden="true">
          <SquareTerminal size={16} strokeWidth={2} />
        </div>
        <div className="message-stack">
          <div className="message-card-shell">
            <div className="message-card-header">
              <div>
                <div className="message-role">{item.name}</div>
              </div>
              <div className="message-header-actions">
                {isRunning ? (
                  <div className="message-status tool-invocation-running">
                    <Loader2 size={13} strokeWidth={2} className="tool-invocation-spinner" aria-hidden="true" />
                    {getStatusLabel(item)}
                  </div>
                ) : (
                  <div className={`message-status ${statusClass}`}>{getStatusLabel(item)}</div>
                )}
                {!isRunning && resultText ? (
                  <button
                    className="message-toggle-button"
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((value) => !value)}
                  >
                    {expanded ? '收起' : '展开'}
                  </button>
                ) : null}
              </div>
            </div>

            {item.argsSummary ? <div className="message-summary">参数摘要：{item.argsSummary}</div> : null}

            {isRunning ? null : expanded ? (
              <MessageContent body={{ kind: 'markdown', text: resultText }} onContextMenu={() => {}} />
            ) : resultText ? (
              <div className="message-content message-content-collapsed">{previewText}</div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
