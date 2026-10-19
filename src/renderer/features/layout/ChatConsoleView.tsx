import type { MouseEvent as ReactMouseEvent, KeyboardEvent, FormEvent, RefObject, UIEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { PendingAttachment, FilePreviewItem, UiWidgetItem, ToolInvocationItem } from '../../lib/hooks/use-chat-session';
import type { AgentMessage } from '../../../shared/agent';
import type { ReasoningEffort } from '../../../shared/config';
import type { AgentProfileListItem } from '../../../shared/agent-profile';
import type { CodeProjectListItem } from '../../../shared/code-project';
import type { McpServerListItem } from '../../../shared/mcp';
import type { ToolConfirmationRequest } from '../../../shared/tools';
import type { ContextMenuState } from '../../lib/types/app-shell';
import type { SlashSkillOption } from '../../lib/utils/slash-command';
import { ActivityPanel } from '../activity/ActivityPanel';
import { Composer } from '../composer/Composer';
import { ConfirmationPanel } from '../confirmation/ConfirmationPanel';
import { MessageContextMenu } from '../context-menu/MessageContextMenu';
import { MessageList } from '../messages/MessageList';

type ChatConsoleViewProps = {
  selectedAgent: AgentProfileListItem | null;
  /** Code 模式下当前绑定的代码工程；非空时顶部展示工程路径。 */
  codeProject?: CodeProjectListItem | null;
  /** 激活会话标题；有值时顶部标题优先显示会话标题。 */
  conversationTitle?: string | null;
  /** 激活会话 id：传给 Composer 用于按会话读取输入记录（↑/↓ 调起）。 */
  activeConversationId?: string | null;
  onToggleCodeProjectWritable?: (writable: boolean) => void;
  /** 可绑定的 MCP 服务清单（与设置面板同源）。 */
  availableMcpServers?: McpServerListItem[];
  /** 保存工程的 MCP 绑定；勾选即保存。 */
  onToggleCodeProjectMcpServer?: (serverName: string, enabled: boolean) => void;
  visibleMessages: AgentMessage[];
  availableSkills: SlashSkillOption[];
  expandedToolMessageKeys: Record<string, boolean>;
  /** preview_* 工具推送的瞬时预览卡片。 */
  filePreviews?: FilePreviewItem[];
  /** ui_form 工具推送的瞬时交互表单。 */
  uiWidgets?: UiWidgetItem[];
  /** run() 工具循环推送的瞬时工具调用卡片。 */
  toolInvocations?: ToolInvocationItem[];
  /** 表单/HTML 组件提交回调。 */
  onUiFormSubmit?: (widgetId: string, values: Record<string, unknown>) => void;
  /** HTML 组件弹出独立窗口 / 收回。 */
  onUiHtmlPopOut?: (widgetId: string) => void;
  onUiHtmlReclaim?: (widgetId: string) => void;
  onToggleToolMessage: (messageKey: string) => void;
  onCopyMessage: (text: string) => void;
  /** 从指定消息回退：删除该消息及其后所有内容（按 id 截断）。 */
  onUndoFromMessage: (messageId: string) => void;
  onMessageContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onConversationBlankContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  contextMenuState: ContextMenuState | null;
  onCopySelection: () => void;
  onResetConversation: () => void;
  chatScrollAreaRef: RefObject<HTMLDivElement | null>;
  composerInputRef?: RefObject<HTMLTextAreaElement | null>;
  hasMoreMessagesBefore: boolean;
  isLoadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  showRunningActivityPanel: boolean;
  showErrorActivityPanel: boolean;
  isRunning: boolean;
  lastError: string | null;
  confirmationRequest: ToolConfirmationRequest | null;
  onRejectConfirmation: () => void;
  onApproveConfirmation: (autoRun: boolean, autoAllowCommand: boolean, autoAllowDomain: boolean) => void;
  input: string;
  attachments: PendingAttachment[];
  onAttachmentsChange: (attachments: PendingAttachment[]) => void;
  thinkingModeEnabled: boolean;
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onThinkingModeChange: (value: boolean) => void;
  reasoningEffortByModel: Record<string, ReasoningEffort>;
  onModelReasoningEffortChange: (model: string, effort: ReasoningEffort) => void;
  availableModels: string[];
  selectedModel: string;
  modelsLoading: boolean;
  modelsError: string | null;
  onModelChange: (model: string) => void;
  onRefreshModels: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

const TOP_LOAD_TRIGGER_PX = 24;

/**
 * Code 工程的 MCP 服务绑定浮层：点开显示服务勾选列表，勾选即保存。
 * 点击外部或再点按钮关闭。
 */
function CodeMcpBindingPopover({
  project,
  availableMcpServers,
  onToggleServer,
  onClose,
}: {
  project: CodeProjectListItem;
  availableMcpServers: McpServerListItem[];
  onToggleServer: (serverName: string, enabled: boolean) => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const enabledSet = new Set(project.mcp.enabledServerNames);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [onClose]);

  return (
    <div className="code-mcp-popover" ref={containerRef} role="dialog" aria-label="MCP 服务绑定">
      <div className="code-mcp-popover-header">
        <span>连接 MCP 服务</span>
        <span className="code-mcp-popover-count">{enabledSet.size} 个已连接</span>
      </div>
      {availableMcpServers.length === 0 ? (
        <div className="code-mcp-popover-empty">暂无可选服务，请先在设置的 MCP 面板中添加。</div>
      ) : (
        <div className="code-mcp-popover-list">
          {availableMcpServers.map((server) => {
            const enabled = enabledSet.has(server.name);
            return (
              <button
                key={server.name}
                type="button"
                className={`code-mcp-popover-item${enabled ? ' code-mcp-popover-item-active' : ''}`}
                onClick={() => onToggleServer(server.name, !enabled)}
              >
                <span className="code-mcp-popover-item-name">{server.name}{server.disabled ? '（已停用）' : ''}</span>
                <span className="code-mcp-popover-item-state" aria-hidden="true">
                  {enabled ? <Check size={13} strokeWidth={2} /> : <Plus size={13} strokeWidth={2} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="code-mcp-popover-footer">外部服务工具若涉及写入/删除/发送会先请求确认。</div>
    </div>
  );
}

export function ChatConsoleView({
  selectedAgent,
  codeProject,
  conversationTitle,
  activeConversationId,
  onToggleCodeProjectWritable,
  availableMcpServers,
  onToggleCodeProjectMcpServer,
  visibleMessages,
  availableSkills,
  expandedToolMessageKeys,
  filePreviews,
  uiWidgets,
  toolInvocations,
  onUiFormSubmit,
  onUiHtmlPopOut,
  onUiHtmlReclaim,
  onToggleToolMessage,
  onCopyMessage,
  onUndoFromMessage,
  onMessageContextMenu,
  onConversationBlankContextMenu,
  contextMenuState,
  onCopySelection,
  onResetConversation,
  chatScrollAreaRef,
  composerInputRef,
  hasMoreMessagesBefore,
  isLoadingOlderMessages,
  onLoadOlderMessages,
  showRunningActivityPanel,
  showErrorActivityPanel,
  isRunning,
  lastError,
  confirmationRequest,
  onRejectConfirmation,
  onApproveConfirmation,
  input,
  attachments,
  onAttachmentsChange,
  thinkingModeEnabled,
  onInputChange,
  onSubmit,
  onCancel,
  onThinkingModeChange,
  reasoningEffortByModel,
  onModelReasoningEffortChange,
  availableModels,
  selectedModel,
  modelsLoading,
  modelsError,
  onModelChange,
  onRefreshModels,
  onKeyDown,
}: ChatConsoleViewProps) {
  const [mcpPopoverOpen, setMcpPopoverOpen] = useState(false);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    if (!hasMoreMessagesBefore || isLoadingOlderMessages || event.currentTarget.scrollTop > TOP_LOAD_TRIGGER_PX) {
      return;
    }

    onLoadOlderMessages();
  }

  return (
    <main className="console-panel">
      <header className="console-header console-divider-bottom">
        {codeProject ? (
          <div className="console-agent-summary console-agent-summary-default console-agent-summary-code">
            <div className="console-agent-summary-topline">
              <h2>{conversationTitle ?? codeProject.name}</h2>
              <div className="console-code-header-actions">
                <div className="console-code-mcp-anchor">
                  <button
                    type="button"
                    className={`ghost-button console-code-write-toggle${codeProject.mcp.enabledServerNames.length > 0 ? ' console-code-mcp-toggle-on' : ''}`}
                    onClick={() => setMcpPopoverOpen((open) => !open)}
                    title="选择该工程可使用的 MCP 服务"
                  >
                    <span
                      className={`console-code-status-dot${codeProject.mcp.enabledServerNames.length > 0 ? ' console-code-status-dot-cyan' : ''}`}
                      aria-hidden="true"
                    />
                    MCP{codeProject.mcp.enabledServerNames.length > 0 ? `：${codeProject.mcp.enabledServerNames.length}` : '：未连接'}
                  </button>
                  {mcpPopoverOpen ? (
                    <CodeMcpBindingPopover
                      project={codeProject}
                      availableMcpServers={availableMcpServers ?? []}
                      onToggleServer={(serverName, enabled) => onToggleCodeProjectMcpServer?.(serverName, enabled)}
                      onClose={() => setMcpPopoverOpen(false)}
                    />
                  ) : null}
                </div>
                <button
                  type="button"
                  className={`ghost-button console-code-write-toggle${codeProject.writable ? ' console-code-write-toggle-on' : ''}`}
                  onClick={() => onToggleCodeProjectWritable?.(!codeProject.writable)}
                  title={codeProject.writable ? '关闭后智能体只能读取该工程' : '开启后智能体可以修改该工程的文件，每次写入仍需你确认'}
                >
                  <span
                    className={`console-code-status-dot${codeProject.writable ? ' console-code-status-dot-amber' : ''}`}
                    aria-hidden="true"
                  />
                  {codeProject.writable ? '允许修改：开' : '允许修改：关'}
                </button>
              </div>
            </div>
            <p className="console-agent-description console-code-project-path" title={codeProject.rootPath}>
              {codeProject.name} · {codeProject.rootPath}
            </p>
          </div>
        ) : selectedAgent ? (
          <>
            <div className="console-agent-badge">{selectedAgent.title.slice(0, 1).toUpperCase()}</div>
            <div className="console-agent-summary">
              <div className="console-agent-summary-topline">
                <h2>{conversationTitle ?? selectedAgent.title}</h2>
              </div>
              <p className="console-agent-description">智能体「{selectedAgent.title}」· 当前会话将使用该智能体的预设能力和绑定资源执行。</p>
            </div>

          </>
        ) : (
          <div className="console-agent-summary console-agent-summary-default">
            <div className="console-agent-summary-topline">
              <h2>{conversationTitle ?? '默认智能体'}</h2>
            </div>
            <p className="console-agent-description">当前请求将直接使用全局模型配置、工具设置和默认智能体会话。</p>
          </div>
        )}
      </header>

      <div className="console-scroll-area" ref={chatScrollAreaRef} onScroll={handleScroll} onContextMenu={onConversationBlankContextMenu}>
        <div className="console-message-stack">
          {isLoadingOlderMessages ? <div className="message-history-status">正在加载更早消息...</div> : null}

          <MessageList
            messages={visibleMessages}
            expandedToolMessageKeys={expandedToolMessageKeys}
            filePreviews={filePreviews}
            uiWidgets={uiWidgets}
            toolInvocations={toolInvocations}
            onUiFormSubmit={onUiFormSubmit}
            onUiHtmlPopOut={onUiHtmlPopOut}
            onUiHtmlReclaim={onUiHtmlReclaim}
            isRunning={isRunning}
            onToggleToolMessage={onToggleToolMessage}
            onCopyMessage={onCopyMessage}
            onUndoFromMessage={onUndoFromMessage}
            onMessageContextMenu={onMessageContextMenu}
          />

          {contextMenuState ? <MessageContextMenu state={contextMenuState} onCopy={onCopySelection} onResetConversation={onResetConversation} /> : null}

          {showRunningActivityPanel || showErrorActivityPanel ? (
            <div className="console-inline-panel">
              <ActivityPanel key={visibleMessages.length} isRunning={showRunningActivityPanel} errorMessage={showErrorActivityPanel ? lastError : null} />
            </div>
          ) : null}

          {confirmationRequest ? (
            <div className="console-inline-panel">
              <ConfirmationPanel confirmationRequest={confirmationRequest} onReject={onRejectConfirmation} onApprove={onApproveConfirmation} />
            </div>
          ) : null}
        </div>
      </div>

      <Composer
        value={input}
        attachments={attachments}
        onAttachmentsChange={onAttachmentsChange}
        isRunning={isRunning}
        thinkingModeEnabled={thinkingModeEnabled}
        availableModels={availableModels}
        selectedModel={selectedModel}
        modelsLoading={modelsLoading}
        modelsError={modelsError}
        onModelChange={onModelChange}
        onRefreshModels={onRefreshModels}
        onChange={onInputChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
        onThinkingModeChange={onThinkingModeChange}
        reasoningEffortByModel={reasoningEffortByModel}
        onModelReasoningEffortChange={onModelReasoningEffortChange}
        onKeyDown={onKeyDown}
        inputRef={composerInputRef}
        conversationId={activeConversationId}
        skills={availableSkills}
      />
    </main>
  );
}
