import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AttachFromPathsResult, DesktopAppApi, ImportedImageResult, PendingAttachmentInput, PersistedAttachmentResult, SkillDetail } from '../shared/contracts';

import type { AgentStreamEvent } from '../shared/agent';
import type { WorkflowStreamEvent } from '../shared/workflow';

import type { SystemToolCatalogItem, ToolConfirmationRequest } from '../shared/tools';
import type { SkillListItem, CreateSkillRequest, UpdateSkillRequest, SkillOperationResult, SkillsChangedEvent } from '../shared/skill-contracts';
import type {
  AgentProfileDetail,
  AgentProfileListItem,
  AgentProfileOperationResult,
  CreateAgentProfileRequest,
  UpdateAgentProfileRequest,
} from '../shared/agent-profile';
import type { McpAgentBinding, McpConfig, McpOperationResult, McpServerListItem, SaveMcpServerRequest } from '../shared/mcp';
import type { CodeProjectListItem, CodeProjectOperationResult, ImportCodeProjectResult } from '../shared/code-project';
import type { UiWindowEvent } from '../shared/ui-form';
import type { MailAccountInput, MailAccountListItem, MailAccountOperationResult, MailTestResult } from '../shared/mail';
import type {
  ConversationChangedEvent,
  ConversationListItem,
  ConversationMessagesPage,
  ConversationMessagesPageRequest,
  ConversationMeta,
  ConversationOperationResult,
  ConversationUnreadSummary,
} from '../shared/conversation';
import type { ScheduledTask } from '../shared/scheduled-task';
import type {
  CreateWorkflowDefinitionRequest,
  CustomWorkflowRunInput,
  CustomWorkflowRunResponse,
  UpdateWorkflowDefinitionRequest,
  WorkflowDefinition,
  WorkflowDefinitionListItem,
  WorkflowDefinitionOperationResult,
} from '../shared/workflow-definition';

const api: DesktopAppApi = {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  reportRendererError: (message) => ipcRenderer.send('app:renderer-error', message),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  listModels: () => ipcRenderer.invoke('models:list'),
  runAgent: (input) => ipcRenderer.invoke('agent:run', input),
  cancelAgent: () => ipcRenderer.invoke('agent:cancel'),
  resetAgent: (scope) => ipcRenderer.invoke('agent:reset', scope),
  getAgentMessages: (scope) => ipcRenderer.invoke('agent:get-messages', scope),
  copyText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  openPath: (targetPath) => ipcRenderer.invoke('attachment:open-path', targetPath) as Promise<void>,
  revealPathInFolder: (targetPath) => ipcRenderer.invoke('attachment:reveal-in-folder', targetPath) as Promise<void>,
  readAttachmentDataUrl: (targetPath, mimeType) => ipcRenderer.invoke('attachment:read-data-url', targetPath, mimeType) as Promise<string>,
  getPathForFile: (file) => webUtils.getPathForFile(file),
  attachFromPaths: (filePaths) => ipcRenderer.invoke('attachment:from-paths', filePaths) as Promise<AttachFromPathsResult>,
  openExternalLink: (url) => ipcRenderer.invoke('shell:open-external', url),
  confirmDialog: (options) =>
    ipcRenderer.invoke('app:confirm', options) as Promise<boolean>,
  alertDialog: (options) => ipcRenderer.invoke('app:alert', options) as Promise<void>,
  respondToolConfirmation: (payload) => ipcRenderer.invoke('tool:confirm-response', payload),
  onToolConfirmationRequested: (listener) => {
    const handler = (_event: unknown, payload: ToolConfirmationRequest) => listener(payload);
    ipcRenderer.on('tool:confirm', handler);
    return () => {
      ipcRenderer.removeListener('tool:confirm', handler);
    };
  },
  onAgentStream: (listener) => {
    const handler = (_event: unknown, payload: AgentStreamEvent) => listener(payload);
    ipcRenderer.on('agent:stream', handler);
    return () => {
      ipcRenderer.removeListener('agent:stream', handler);
    };
  },
  onConversationChanged: (listener) => {
    const handler = (_event: unknown, payload: ConversationChangedEvent) => listener(payload);
    ipcRenderer.on('conversation:changed', handler);
    return () => {
      ipcRenderer.removeListener('conversation:changed', handler);
    };
  },
  onSkillsChanged: (listener) => {
    const handler = (_event: unknown, payload: SkillsChangedEvent) => listener(payload);
    ipcRenderer.on('skills:changed', handler);
    return () => {
      ipcRenderer.removeListener('skills:changed', handler);
    };
  },
  openUiWindow: (input) => ipcRenderer.invoke('ui-window:open', input),
  closeUiWindow: (widgetId) => ipcRenderer.invoke('ui-window:close', widgetId) as Promise<void>,
  claimUiWindow: (token) => ipcRenderer.invoke('ui-window:claim', token),
  submitUiWindow: (input) => ipcRenderer.invoke('ui-window:submit', input) as Promise<void>,
  onUiWindowEvent: (listener) => {
    const handler = (_event: unknown, payload: UiWindowEvent) => listener(payload);
    ipcRenderer.on('ui-window:event', handler);
    return () => {
      ipcRenderer.removeListener('ui-window:event', handler);
    };
  },
  startDebateWorkflow: (input) => ipcRenderer.invoke('workflow:start-debate', input),
  startDeepResearchWorkflow: (input) => ipcRenderer.invoke('workflow:start-deep-research', input),
  startCustomWorkflow: (input) => ipcRenderer.invoke('workflow:start-custom', input as CustomWorkflowRunInput) as Promise<CustomWorkflowRunResponse>,
  getWorkflowRun: (runId) => ipcRenderer.invoke('workflow:get-run', runId),

  listWorkflowRuns: () => ipcRenderer.invoke('workflow:list-runs'),
  cancelWorkflowRun: (runId) => ipcRenderer.invoke('workflow:cancel-run', runId),
  exportWorkflowReport: (runId) => ipcRenderer.invoke('workflow:export-report', runId),
  onWorkflowStream: (listener) => {
    const handler = (_event: unknown, payload: WorkflowStreamEvent) => listener(payload);
    ipcRenderer.on('workflow:stream', handler);
    return () => {
      ipcRenderer.removeListener('workflow:stream', handler);
    };
  },
  listSystemToolCatalog: () => ipcRenderer.invoke('tools:catalog') as Promise<SystemToolCatalogItem[]>,
  listSkills: () => ipcRenderer.invoke('skill:list') as Promise<SkillListItem[]>,

  getSkill: (name) => ipcRenderer.invoke('skill:get', name) as Promise<SkillDetail | null>,
  createSkill: (request) => ipcRenderer.invoke('skill:create', request) as Promise<SkillOperationResult>,
  updateSkill: (request) => ipcRenderer.invoke('skill:update', request) as Promise<SkillOperationResult>,
  deleteSkill: (directoryName) => ipcRenderer.invoke('skill:delete', directoryName) as Promise<SkillOperationResult>,
  reloadSkills: () => ipcRenderer.invoke('skill:reload') as Promise<SkillOperationResult>,
  getSkillsDirectory: () => ipcRenderer.invoke('skill:get-directory') as Promise<string>,
  openSkillsDirectory: () => ipcRenderer.invoke('skill:open-directory') as Promise<void>,
  getSkillTemplate: () => ipcRenderer.invoke('skill:get-template') as Promise<string>,
  listAgents: () => ipcRenderer.invoke('agent-profile:list') as Promise<AgentProfileListItem[]>,
  getAgent: (id) => ipcRenderer.invoke('agent-profile:get', id) as Promise<AgentProfileDetail | null>,
  createAgent: (request) => ipcRenderer.invoke('agent-profile:create', request as CreateAgentProfileRequest) as Promise<AgentProfileOperationResult>,
  updateAgent: (request) => ipcRenderer.invoke('agent-profile:update', request as UpdateAgentProfileRequest) as Promise<AgentProfileOperationResult>,
  deleteAgent: (id) => ipcRenderer.invoke('agent-profile:delete', id) as Promise<AgentProfileOperationResult>,
  reloadAgents: () => ipcRenderer.invoke('agent-profile:reload') as Promise<AgentProfileOperationResult>,
  getAgentsDirectory: () => ipcRenderer.invoke('agent-profile:get-directory') as Promise<string>,
  openAgentsDirectory: () => ipcRenderer.invoke('agent-profile:open-directory') as Promise<void>,
  listWorkflows: () => ipcRenderer.invoke('workflow-definition:list') as Promise<WorkflowDefinitionListItem[]>,
  getWorkflow: (id) => ipcRenderer.invoke('workflow-definition:get', id) as Promise<WorkflowDefinition | null>,
  createWorkflow: (request) => ipcRenderer.invoke('workflow-definition:create', request as CreateWorkflowDefinitionRequest) as Promise<WorkflowDefinitionOperationResult>,
  updateWorkflow: (request) => ipcRenderer.invoke('workflow-definition:update', request as UpdateWorkflowDefinitionRequest) as Promise<WorkflowDefinitionOperationResult>,
  deleteWorkflow: (id) => ipcRenderer.invoke('workflow-definition:delete', id) as Promise<WorkflowDefinitionOperationResult>,
  reloadWorkflows: () => ipcRenderer.invoke('workflow-definition:reload') as Promise<WorkflowDefinitionOperationResult>,
  getWorkflowsDirectory: () => ipcRenderer.invoke('workflow-definition:get-directory') as Promise<string>,
  openWorkflowsDirectory: () => ipcRenderer.invoke('workflow-definition:open-directory') as Promise<void>,
  listWorkflowsByAgent: (agentId) => ipcRenderer.invoke('workflow-definition:list-by-agent', agentId) as Promise<WorkflowDefinitionListItem[]>,
  listCodeProjects: () => ipcRenderer.invoke('code-project:list') as Promise<CodeProjectListItem[]>,
  importCodeProject: () => ipcRenderer.invoke('code-project:import') as Promise<ImportCodeProjectResult>,
  removeCodeProject: (id) => ipcRenderer.invoke('code-project:remove', id) as Promise<CodeProjectOperationResult>,
  setCodeProjectWritable: (id, writable) => ipcRenderer.invoke('code-project:set-writable', id, writable) as Promise<CodeProjectOperationResult>,
  setCodeProjectMcpBinding: (id, enabledServerNames) => ipcRenderer.invoke('code-project:set-mcp-binding', id, enabledServerNames) as Promise<CodeProjectOperationResult>,
  openCodeProjectDirectory: (id) => ipcRenderer.invoke('code-project:open-directory', id) as Promise<void>,
  listConversations: () => ipcRenderer.invoke('conversation:list') as Promise<ConversationListItem[]>,
  listConversationsByAgent: (agentId) => ipcRenderer.invoke('conversation:list-by-agent', agentId) as Promise<ConversationListItem[]>,
  getConversation: (id) => ipcRenderer.invoke('conversation:get', id) as Promise<ConversationMeta | null>,
  createConversation: (agentId, title) => ipcRenderer.invoke('conversation:create', agentId, title) as Promise<ConversationMeta>,
  deleteConversation: (id) => ipcRenderer.invoke('conversation:delete', id) as Promise<ConversationOperationResult>,
  renameConversation: (conversationId, title) =>
    ipcRenderer.invoke('conversation:rename', conversationId, title) as Promise<ConversationOperationResult>,
  truncateConversation: (conversationId, messageId) =>
    ipcRenderer.invoke('conversation:truncate', conversationId, messageId) as Promise<ConversationOperationResult>,
  selectFiles: () => ipcRenderer.invoke('attachment:select-files') as Promise<PendingAttachmentInput[]>,
  importPastedImage: (imageBuffer, fileName, mimeType) =>
    ipcRenderer.invoke('attachment:import-image', imageBuffer, fileName, mimeType) as Promise<ImportedImageResult>,
  persistAttachments: (conversationId, attachments) =>
    ipcRenderer.invoke('attachment:persist', conversationId, attachments as PendingAttachmentInput[]) as Promise<PersistedAttachmentResult[]>,
  getConversationMessages: (conversationId) => ipcRenderer.invoke('conversation:get-messages', conversationId) as Promise<import('../shared/agent').AgentMessage[]>,
  getConversationMessagesPage: (conversationId, request) =>
    ipcRenderer.invoke('conversation:get-messages-page', conversationId, request as ConversationMessagesPageRequest) as Promise<ConversationMessagesPage>,
  resetConversation: (conversationId) => ipcRenderer.invoke('conversation:reset', conversationId) as Promise<ConversationOperationResult>,
  reloadConversations: () => ipcRenderer.invoke('conversation:reload') as Promise<void>,
  getConversationsDirectory: () => ipcRenderer.invoke('conversation:get-directory') as Promise<string>,
  clearConversationUnread: (conversationId) => ipcRenderer.invoke('conversation:clear-unread', conversationId) as Promise<number>,
  getConversationUnreadSummary: () => ipcRenderer.invoke('conversation:unread-summary') as Promise<ConversationUnreadSummary>,
  listScheduledTasks: (conversationId) => ipcRenderer.invoke('scheduled-task:list', conversationId) as Promise<ScheduledTask[]>,
  getMcpConfig: () => ipcRenderer.invoke('mcp:get-config') as Promise<McpConfig>,
  listMcpServers: () => ipcRenderer.invoke('mcp:list-servers') as Promise<McpServerListItem[]>,
  saveMcpServer: (request) => ipcRenderer.invoke('mcp:save-server', request as SaveMcpServerRequest) as Promise<McpOperationResult>,
  deleteMcpServer: (name) => ipcRenderer.invoke('mcp:delete-server', name) as Promise<McpOperationResult>,
  saveDefaultAgentMcpBinding: (binding) => ipcRenderer.invoke('mcp:save-default-binding', binding as McpAgentBinding) as Promise<McpOperationResult>,
  getMcpConfigPath: () => ipcRenderer.invoke('mcp:get-config-path') as Promise<string>,
  openMcpConfigFile: () => ipcRenderer.invoke('mcp:open-config-file') as Promise<void>,
  listMailAccounts: () => ipcRenderer.invoke('mail:list-accounts') as Promise<MailAccountListItem[]>,
  saveMailAccount: (input) => ipcRenderer.invoke('mail:save-account', input as MailAccountInput) as Promise<MailAccountOperationResult>,
  deleteMailAccount: (id) => ipcRenderer.invoke('mail:delete-account', id) as Promise<MailAccountOperationResult>,
  setDefaultMailAccount: (id) => ipcRenderer.invoke('mail:set-default-account', id) as Promise<MailAccountOperationResult>,
  testMailAccount: (input) => ipcRenderer.invoke('mail:test-account', input as MailAccountInput) as Promise<MailTestResult>,
  testMailAccountById: (id) => ipcRenderer.invoke('mail:test-account-by-id', id) as Promise<MailTestResult>,
  getMailConfigPath: () => ipcRenderer.invoke('mail:get-config-path') as Promise<string>,
};

contextBridge.exposeInMainWorld('desktopApp', api);
