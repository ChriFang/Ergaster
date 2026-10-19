import type { AppConfig } from '../../../shared/config';
import type { PendingAttachmentInput } from '../../../shared/contracts';
import type { AgentConversationScope, AgentRunInput } from '../../../shared/agent';
import type { DebateRunInput, DeepResearchRunInput } from '../../../shared/workflow';
import type { CustomWorkflowRunInput, CustomWorkflowRunResponse } from '../../../shared/workflow-definition';
import type { ConversationMessagesPageRequest } from '../../../shared/conversation';
import type { UiWindowOpenInput, UiWindowSubmitInput } from '../../../shared/ui-form';
import type { ToolConfirmationResponsePayload } from '../../../shared/tools';



export const desktopAppClient = {
  getAppInfo: () => window.desktopApp.getAppInfo(),
  reportRendererError: (message: string) => window.desktopApp.reportRendererError(message),
  getConfig: () => window.desktopApp.getConfig(),
  saveConfig: (config: Partial<AppConfig>) => window.desktopApp.saveConfig(config),
  listModels: () => window.desktopApp.listModels(),
  getAgentMessages: (scope?: AgentConversationScope) => window.desktopApp.getAgentMessages(scope),
  runAgent: (input: AgentRunInput) => window.desktopApp.runAgent(input),
  cancelAgent: () => window.desktopApp.cancelAgent(),
  resetAgent: (scope?: AgentConversationScope) => window.desktopApp.resetAgent(scope),
  respondToolConfirmation: (payload: ToolConfirmationResponsePayload) => window.desktopApp.respondToolConfirmation(payload),
  listConversations: () => window.desktopApp.listConversations(),
  listConversationsByAgent: (agentId: string | null) => window.desktopApp.listConversationsByAgent(agentId),
  getConversation: (id: string) => window.desktopApp.getConversation(id),
  createConversation: (agentId: string | null, title?: string) => window.desktopApp.createConversation(agentId, title),
  deleteConversation: (id: string) => window.desktopApp.deleteConversation(id),
  renameConversation: (conversationId: string, title: string) => window.desktopApp.renameConversation(conversationId, title),
  truncateConversation: (conversationId: string, messageId: string) => window.desktopApp.truncateConversation(conversationId, messageId),
  selectFiles: () => window.desktopApp.selectFiles(),
  importPastedImage: (imageBuffer: ArrayBuffer, fileName: string, mimeType: string) => window.desktopApp.importPastedImage(imageBuffer, fileName, mimeType),
  persistAttachments: (conversationId: string, attachments: PendingAttachmentInput[]) => window.desktopApp.persistAttachments(conversationId, attachments),
  getConversationMessages: (conversationId: string) => window.desktopApp.getConversationMessages(conversationId),
  getConversationMessagesPage: (conversationId: string, request: ConversationMessagesPageRequest) => window.desktopApp.getConversationMessagesPage(conversationId, request),
  resetConversation: (conversationId: string) => window.desktopApp.resetConversation(conversationId),
  reloadConversations: () => window.desktopApp.reloadConversations(),
  getConversationsDirectory: () => window.desktopApp.getConversationsDirectory(),
  clearConversationUnread: (conversationId: string) => window.desktopApp.clearConversationUnread(conversationId),
  getConversationUnreadSummary: () => window.desktopApp.getConversationUnreadSummary(),
  listScheduledTasks: (conversationId?: string) => window.desktopApp.listScheduledTasks(conversationId),
  reloadAgents: () => window.desktopApp.reloadAgents(),
  listAgents: () => window.desktopApp.listAgents(),
  listSkills: () => window.desktopApp.listSkills(),
  getSkill: (name: string) => window.desktopApp.getSkill(name),
  listWorkflows: () => window.desktopApp.listWorkflows(),
  getWorkflow: (id: string) => window.desktopApp.getWorkflow(id),
  createWorkflow: (request: Parameters<typeof window.desktopApp.createWorkflow>[0]) => window.desktopApp.createWorkflow(request),
  updateWorkflow: (request: Parameters<typeof window.desktopApp.updateWorkflow>[0]) => window.desktopApp.updateWorkflow(request),
  deleteWorkflow: (id: string) => window.desktopApp.deleteWorkflow(id),
  reloadWorkflows: () => window.desktopApp.reloadWorkflows(),
  openWorkflowsDirectory: () => window.desktopApp.openWorkflowsDirectory(),
  listWorkflowsByAgent: (agentId: string) => window.desktopApp.listWorkflowsByAgent(agentId),
  listCodeProjects: () => window.desktopApp.listCodeProjects(),
  importCodeProject: () => window.desktopApp.importCodeProject(),
  removeCodeProject: (id: string) => window.desktopApp.removeCodeProject(id),
  setCodeProjectWritable: (id: string, writable: boolean) => window.desktopApp.setCodeProjectWritable(id, writable),
  setCodeProjectMcpBinding: (id: string, enabledServerNames: string[]) => window.desktopApp.setCodeProjectMcpBinding(id, enabledServerNames),
  listMcpServers: () => window.desktopApp.listMcpServers(),
  openCodeProjectDirectory: (id: string) => window.desktopApp.openCodeProjectDirectory(id),
  startCustomWorkflow: (input: CustomWorkflowRunInput) => window.desktopApp.startCustomWorkflow(input) as Promise<CustomWorkflowRunResponse>,
  copyText: (text: string) => window.desktopApp.copyText(text),
  openPath: (targetPath: string) => window.desktopApp.openPath(targetPath),
  confirmDialog: (options: { message: string; detail?: string; confirmText?: string; cancelText?: string }) =>
    window.desktopApp.confirmDialog(options),
  alertDialog: (options: { message: string; detail?: string }) => window.desktopApp.alertDialog(options),
  readAttachmentDataUrl: (targetPath: string, mimeType: string) => window.desktopApp.readAttachmentDataUrl(targetPath, mimeType),
  getPathForFile: (file: File) => window.desktopApp.getPathForFile(file),
  attachFromPaths: (filePaths: string[]) => window.desktopApp.attachFromPaths(filePaths),
  onToolConfirmationRequested: (listener: Parameters<typeof window.desktopApp.onToolConfirmationRequested>[0]) =>
    window.desktopApp.onToolConfirmationRequested(listener),
  onAgentStream: (listener: Parameters<typeof window.desktopApp.onAgentStream>[0]) => window.desktopApp.onAgentStream(listener),
  onConversationChanged: (listener: Parameters<typeof window.desktopApp.onConversationChanged>[0]) => window.desktopApp.onConversationChanged(listener),
  onSkillsChanged: (listener: Parameters<typeof window.desktopApp.onSkillsChanged>[0]) => window.desktopApp.onSkillsChanged(listener),
  openUiWindow: (input: UiWindowOpenInput) => window.desktopApp.openUiWindow(input),
  closeUiWindow: (widgetId: string) => window.desktopApp.closeUiWindow(widgetId),
  claimUiWindow: (token: string) => window.desktopApp.claimUiWindow(token),
  submitUiWindow: (input: UiWindowSubmitInput) => window.desktopApp.submitUiWindow(input),
  onUiWindowEvent: (listener: Parameters<typeof window.desktopApp.onUiWindowEvent>[0]) => window.desktopApp.onUiWindowEvent(listener),
  startDebateWorkflow: (input: DebateRunInput) => window.desktopApp.startDebateWorkflow(input),
  startDeepResearchWorkflow: (input: DeepResearchRunInput) => window.desktopApp.startDeepResearchWorkflow(input),
  getWorkflowRun: (runId: string) => window.desktopApp.getWorkflowRun(runId),

  listWorkflowRuns: () => window.desktopApp.listWorkflowRuns(),
  cancelWorkflowRun: (runId: string) => window.desktopApp.cancelWorkflowRun(runId),
  exportWorkflowReport: (runId: string) => window.desktopApp.exportWorkflowReport(runId),
  onWorkflowStream: (listener: Parameters<typeof window.desktopApp.onWorkflowStream>[0]) => window.desktopApp.onWorkflowStream(listener),
};

