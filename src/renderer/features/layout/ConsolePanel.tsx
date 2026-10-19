import type { MouseEvent as ReactMouseEvent, KeyboardEvent, FormEvent, RefObject } from 'react';
import type { PendingAttachment, FilePreviewItem, UiWidgetItem, ToolInvocationItem } from '../../lib/hooks/use-chat-session';
import type { AgentMessage } from '../../../shared/agent';
import type { AgentProfileListItem } from '../../../shared/agent-profile';
import type { CodeProjectListItem } from '../../../shared/code-project';
import type { ToolConfirmationRequest } from '../../../shared/tools';
import type { WorkflowArtifact, WorkflowRun } from '../../../shared/workflow';
import type { ReasoningEffort } from '../../../shared/config';
import type { WorkflowDefinitionListItem } from '../../../shared/workflow-definition';
import type { ContextMenuState } from '../../lib/types/app-shell';
import type { SlashSkillOption } from '../../lib/utils/slash-command';
import type { McpServerListItem } from '../../../shared/mcp';
import { WorkflowConsoleView } from '../workflows/WorkflowConsoleView';
import type { ReportExportNotice } from '../workflows/WorkflowConsoleView';
import { ChatConsoleView } from './ChatConsoleView';

type ConsolePanelProps = {
  mode: 'chat' | 'workflow' | 'code';
  selectedAgent: AgentProfileListItem | null;
  codeProject: CodeProjectListItem | null;
  /** 激活会话标题；命中时聊天视图头部优先展示它而不是智能体/工程名。 */
  conversationTitle: string | null;
  /** 激活会话 id：透传给 Composer 按会话读取输入记录。 */
  activeConversationId: string | null;
  onToggleCodeProjectWritable: (writable: boolean) => void;
  /** 可绑定的 MCP 服务清单（与设置面板同源）。 */
  availableMcpServers: McpServerListItem[];
  /** 保存 Code 工程的 MCP 绑定。 */
  onToggleCodeProjectMcpServer: (serverName: string, enabled: boolean) => void;
  visibleMessages: AgentMessage[];
  activeRun: WorkflowRun | null;
  workflowArtifacts: WorkflowArtifact[];
  /** "/" 指令候选，只在聊天视图启用；工作流视图不下传。 */
  availableSkills: SlashSkillOption[];
  selectedWorkflowType: 'debate' | 'deep_research' | 'custom';
  workflows: WorkflowDefinitionListItem[];
  selectedCustomWorkflowId: string | null;
  expandedToolMessageKeys: Record<string, boolean>;
  /** preview_* 工具推送的瞬时预览卡片，仅聊天视图展示。 */
  filePreviews?: FilePreviewItem[];
  /** ui_form 工具推送的瞬时交互表单，仅聊天视图展示。 */
  uiWidgets?: UiWidgetItem[];
  /** run() 工具循环推送的瞬时工具调用卡片，仅聊天视图展示。 */
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
  isWorkflowRunning: boolean;
  lastError: string | null;
  lastWorkflowError: string | null;
  isExportingReport: boolean;
  reportExportNotice: ReportExportNotice | null;
  onExportReport: () => void;
  onOpenPath: (targetPath: string) => void;
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

export function ConsolePanel({
  mode,
  selectedAgent,
  codeProject,
  conversationTitle,
  activeConversationId,
  onToggleCodeProjectWritable,
  availableMcpServers,
  onToggleCodeProjectMcpServer,
  visibleMessages,
  activeRun,
  workflowArtifacts,
  availableSkills,
  selectedWorkflowType,
  workflows,
  selectedCustomWorkflowId,
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
  isWorkflowRunning,
  lastError,
  lastWorkflowError,
  isExportingReport,
  reportExportNotice,
  onExportReport,
  onOpenPath,
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
}: ConsolePanelProps) {
  if (mode === 'workflow') {
    return (
      <WorkflowConsoleView
        activeRun={activeRun}
        workflowArtifacts={workflowArtifacts}
        selectedWorkflowType={selectedWorkflowType}
        selectedCustomWorkflowId={selectedCustomWorkflowId}
        workflows={workflows}
        expandedToolMessageKeys={expandedToolMessageKeys}
      onToggleToolMessage={onToggleToolMessage}
      onCopyMessage={onCopyMessage}
      onMessageContextMenu={onMessageContextMenu}
      onConversationBlankContextMenu={onConversationBlankContextMenu}
      contextMenuState={contextMenuState}
        onCopySelection={onCopySelection}
        onResetConversation={onResetConversation}
        chatScrollAreaRef={chatScrollAreaRef}
        composerInputRef={composerInputRef}
        input={input}
        isRunning={isWorkflowRunning}
        lastError={lastWorkflowError}
        isExportingReport={isExportingReport}
        reportExportNotice={reportExportNotice}
        onExportReport={onExportReport}
        onOpenPath={onOpenPath}
        thinkingModeEnabled={thinkingModeEnabled}
        availableModels={availableModels}
        selectedModel={selectedModel}
        modelsLoading={modelsLoading}
        modelsError={modelsError}
        onModelChange={onModelChange}
        onRefreshModels={onRefreshModels}
        onInputChange={onInputChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
        onThinkingModeChange={onThinkingModeChange}
        reasoningEffortByModel={reasoningEffortByModel}
        onModelReasoningEffortChange={onModelReasoningEffortChange}
        onKeyDown={onKeyDown}
      />
    );
  }

  return (
    <ChatConsoleView
      selectedAgent={selectedAgent}
      codeProject={mode === 'code' ? codeProject : null}
      conversationTitle={conversationTitle}
      activeConversationId={activeConversationId}
      onToggleCodeProjectWritable={onToggleCodeProjectWritable}
      availableMcpServers={availableMcpServers}
      onToggleCodeProjectMcpServer={onToggleCodeProjectMcpServer}
      visibleMessages={visibleMessages}
      availableSkills={availableSkills}
      expandedToolMessageKeys={expandedToolMessageKeys}
      filePreviews={filePreviews}
      uiWidgets={uiWidgets}
      toolInvocations={toolInvocations}
      onUiFormSubmit={onUiFormSubmit}
      onUiHtmlPopOut={onUiHtmlPopOut}
      onUiHtmlReclaim={onUiHtmlReclaim}
      onToggleToolMessage={onToggleToolMessage}
      onCopyMessage={onCopyMessage}
      onUndoFromMessage={onUndoFromMessage}
      onMessageContextMenu={onMessageContextMenu}
      onConversationBlankContextMenu={onConversationBlankContextMenu}
      contextMenuState={contextMenuState}
      onCopySelection={onCopySelection}
      onResetConversation={onResetConversation}
      chatScrollAreaRef={chatScrollAreaRef}
      composerInputRef={composerInputRef}
      hasMoreMessagesBefore={hasMoreMessagesBefore}
      isLoadingOlderMessages={isLoadingOlderMessages}
      onLoadOlderMessages={onLoadOlderMessages}
      showRunningActivityPanel={showRunningActivityPanel}
      showErrorActivityPanel={showErrorActivityPanel}
      isRunning={isRunning || isWorkflowRunning}
      lastError={lastError}
      confirmationRequest={confirmationRequest}
      onRejectConfirmation={onRejectConfirmation}
      onApproveConfirmation={onApproveConfirmation}
      input={input}
      attachments={attachments}
      onAttachmentsChange={onAttachmentsChange}
      thinkingModeEnabled={thinkingModeEnabled}
      availableModels={availableModels}
      selectedModel={selectedModel}
      modelsLoading={modelsLoading}
      modelsError={modelsError}
      onModelChange={onModelChange}
      onRefreshModels={onRefreshModels}
      onInputChange={onInputChange}
      onSubmit={onSubmit}
      onCancel={onCancel}
      onThinkingModeChange={onThinkingModeChange}
      reasoningEffortByModel={reasoningEffortByModel}
      onModelReasoningEffortChange={onModelReasoningEffortChange}
      onKeyDown={onKeyDown}
    />
  );
}
