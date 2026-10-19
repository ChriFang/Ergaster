import type {
  ConversationChangedEvent,
  ConversationListItem,
  ConversationMeta,
  ConversationMessagesPage,
  ConversationMessagesPageRequest,
  ConversationOperationResult,
  ConversationUnreadSummary,
} from './conversation';
import type { AgentConversationScope, AgentMessage, AgentResponse, AgentRunInput, CancelAgentResponse, AgentStreamEvent } from './agent';
import type {
  CancelWorkflowResponse,
  DebateRunInput,
  DebateRunResponse,
  DeepResearchRunInput,
  DeepResearchRunResponse,
  ExportWorkflowReportResponse,
  WorkflowRun,
  WorkflowStreamEvent,
} from './workflow';
import type { AppConfig, MaskedAppConfig } from './config';
import type { AttachmentMeta } from './attachment';
import type { SystemToolCatalogItem, ToolConfirmationRequest, ToolConfirmationResponsePayload } from './tools';
import type { SkillListItem, CreateSkillRequest, UpdateSkillRequest, SkillOperationResult, SkillsChangedEvent } from './skill-contracts';
import type {
  AgentProfileDetail,
  AgentProfileListItem,
  AgentProfileOperationResult,
  CreateAgentProfileRequest,
  UpdateAgentProfileRequest,
} from './agent-profile';
import type {
  CreateWorkflowDefinitionRequest,
  CustomWorkflowRunInput,
  CustomWorkflowRunResponse,
  UpdateWorkflowDefinitionRequest,
  WorkflowDefinition,
  WorkflowDefinitionListItem,
  WorkflowDefinitionOperationResult,
} from './workflow-definition';
import type { McpAgentBinding, McpConfig, McpOperationResult, McpServerListItem, SaveMcpServerRequest } from './mcp';
import type { CodeProjectListItem, CodeProjectOperationResult, ImportCodeProjectResult } from './code-project';
import type { MailAccountInput, MailAccountListItem, MailAccountOperationResult, MailTestResult } from './mail';
import type { UiWindowEvent, UiWindowOpenInput, UiWindowPayload, UiWindowSubmitInput } from './ui-form';
import type { ScheduledTask } from './scheduled-task';

export type AppInfo = {
  name: string;
  version: string;
  platform: NodeJS.Platform;
};

export type SkillDetail = {
  name: string;
  description: string;
  content: string;
  directoryName: string;
  directoryPath: string;
};

export type PendingAttachmentInput = {
  localPath: string;
  meta: AttachmentMeta;
};

export type AttachFromPathsResult = {
  /** 可作为附件处理的文件（已构建好附件元数据，内容会被预提取）。 */
  attachments: PendingAttachmentInput[];
  /** 不支持作为附件的文件路径：主进程已将其加入运行时工具白名单，渲染层应把它们作为路径引用插入输入区，由模型调用系统工具处理。 */
  unsupportedPaths: string[];
  /** 单个文件处理失败的错误信息（逐条反馈，不再让整批拖拽失败）。 */
  errors: string[];
};

export type ImportedImageResult = {
  localPath: string;
  size: number;
};

export type PersistedAttachmentResult = {
  storedPath: string;
  meta: AttachmentMeta;
};

export type DesktopAppApi = {
  getAppInfo: () => Promise<AppInfo>;
  /** 渲染层未捕获异常转发到主进程日志。火后不理，仅用于崩溃诊断。 */
  reportRendererError: (message: string) => void;
  getConfig: () => Promise<MaskedAppConfig>;
  saveConfig: (config: Partial<AppConfig>) => Promise<MaskedAppConfig>;
  listModels: () => Promise<string[]>;
  runAgent: (input: AgentRunInput) => Promise<AgentResponse>;
  cancelAgent: () => Promise<CancelAgentResponse>;
  resetAgent: (scope?: AgentConversationScope) => Promise<void>;
  getAgentMessages: (scope?: AgentConversationScope) => Promise<AgentMessage[]>;
  copyText: (text: string) => Promise<void>;
  openPath: (targetPath: string) => Promise<void>;
  /** 在系统文件管理器中显示该文件并选中。与 openPath 的区别：打开的是所在目录而非文件本身。 */
  revealPathInFolder: (targetPath: string) => Promise<void>;
  readAttachmentDataUrl: (targetPath: string, mimeType: string) => Promise<string>;
  getPathForFile: (file: File) => string;
  attachFromPaths: (filePaths: string[]) => Promise<AttachFromPathsResult>;
  openExternalLink: (url: string) => Promise<void>;
  /** 主进程原生确认对话框（替代 window.confirm，规避其导致 renderer 鼠标事件失效的问题）。 */
  confirmDialog: (options: { message: string; detail?: string; confirmText?: string; cancelText?: string }) => Promise<boolean>;
  /** 主进程原生提示对话框（替代 window.alert）。 */
  alertDialog: (options: { message: string; detail?: string }) => Promise<void>;
  respondToolConfirmation: (payload: ToolConfirmationResponsePayload) => Promise<boolean>;
  onToolConfirmationRequested: (listener: (request: ToolConfirmationRequest) => void) => () => void;
  listSystemToolCatalog: () => Promise<SystemToolCatalogItem[]>;
  onAgentStream: (listener: (event: AgentStreamEvent) => void) => () => void;
  onConversationChanged: (listener: (event: ConversationChangedEvent) => void) => () => void;
  /** 主进程推送的 Skills 集合变更（新增/更新/删除/安装），用于列表即时刷新。 */
  onSkillsChanged: (listener: (event: SkillsChangedEvent) => void) => () => void;
  /** 打开交互式 HTML widget 的独立窗口（主进程新开 BrowserWindow 承载同款 sandbox iframe）。 */
  openUiWindow: (input: UiWindowOpenInput) => Promise<{ opened: boolean }>;
  /** 收回：关闭指定 widget 的独立窗口（关闭事件会让内联卡片恢复）。 */
  closeUiWindow: (widgetId: string) => Promise<void>;
  /** 弹出窗口 renderer 凭 token 认领自己的载荷。 */
  claimUiWindow: (token: string) => Promise<UiWindowPayload | null>;
  /** 弹出窗口内提交回传主进程，由主进程转发主窗口触发 runAgent。 */
  submitUiWindow: (input: UiWindowSubmitInput) => Promise<void>;
  /** 主进程推送的弹出窗口事件（submit/closed）。 */
  onUiWindowEvent: (listener: (event: UiWindowEvent) => void) => () => void;
  startDebateWorkflow: (input: DebateRunInput) => Promise<DebateRunResponse>;
  startDeepResearchWorkflow: (input: DeepResearchRunInput) => Promise<DeepResearchRunResponse>;
  startCustomWorkflow: (input: CustomWorkflowRunInput) => Promise<CustomWorkflowRunResponse>;
  getWorkflowRun: (runId: string) => Promise<WorkflowRun | null>;
  listWorkflowRuns: () => Promise<WorkflowRun[]>;
  cancelWorkflowRun: (runId: string) => Promise<CancelWorkflowResponse>;
  exportWorkflowReport: (runId: string) => Promise<ExportWorkflowReportResponse>;
  onWorkflowStream: (listener: (event: WorkflowStreamEvent) => void) => () => void;
  listSkills: () => Promise<SkillListItem[]>;
  getSkill: (name: string) => Promise<SkillDetail | null>;
  createSkill: (request: CreateSkillRequest) => Promise<SkillOperationResult>;
  updateSkill: (request: UpdateSkillRequest) => Promise<SkillOperationResult>;
  deleteSkill: (directoryName: string) => Promise<SkillOperationResult>;
  reloadSkills: () => Promise<SkillOperationResult>;
  getSkillsDirectory: () => Promise<string>;
  openSkillsDirectory: () => Promise<void>;
  getSkillTemplate: () => Promise<string>;
  listAgents: () => Promise<AgentProfileListItem[]>;
  getAgent: (id: string) => Promise<AgentProfileDetail | null>;
  createAgent: (request: CreateAgentProfileRequest) => Promise<AgentProfileOperationResult>;
  updateAgent: (request: UpdateAgentProfileRequest) => Promise<AgentProfileOperationResult>;
  deleteAgent: (id: string) => Promise<AgentProfileOperationResult>;
  reloadAgents: () => Promise<AgentProfileOperationResult>;
  getAgentsDirectory: () => Promise<string>;
  openAgentsDirectory: () => Promise<void>;
  listWorkflows: () => Promise<WorkflowDefinitionListItem[]>;
  getWorkflow: (id: string) => Promise<WorkflowDefinition | null>;
  createWorkflow: (request: CreateWorkflowDefinitionRequest) => Promise<WorkflowDefinitionOperationResult>;
  updateWorkflow: (request: UpdateWorkflowDefinitionRequest) => Promise<WorkflowDefinitionOperationResult>;
  deleteWorkflow: (id: string) => Promise<WorkflowDefinitionOperationResult>;
  reloadWorkflows: () => Promise<WorkflowDefinitionOperationResult>;
  getWorkflowsDirectory: () => Promise<string>;
  openWorkflowsDirectory: () => Promise<void>;
  listWorkflowsByAgent: (agentId: string) => Promise<WorkflowDefinitionListItem[]>;
  listCodeProjects: () => Promise<CodeProjectListItem[]>;
  importCodeProject: () => Promise<ImportCodeProjectResult>;
  removeCodeProject: (id: string) => Promise<CodeProjectOperationResult>;
  setCodeProjectWritable: (id: string, writable: boolean) => Promise<CodeProjectOperationResult>;
  setCodeProjectMcpBinding: (id: string, enabledServerNames: string[]) => Promise<CodeProjectOperationResult>;
  openCodeProjectDirectory: (id: string) => Promise<void>;
  listConversations: () => Promise<ConversationListItem[]>;
  listConversationsByAgent: (agentId: string | null) => Promise<ConversationListItem[]>;
  getConversation: (id: string) => Promise<ConversationMeta | null>;
  createConversation: (agentId: string | null, title?: string) => Promise<ConversationMeta>;
  deleteConversation: (id: string) => Promise<ConversationOperationResult>;
  renameConversation: (conversationId: string, title: string) => Promise<ConversationOperationResult>;
  truncateConversation: (conversationId: string, messageId: string) => Promise<ConversationOperationResult>;
  selectFiles: () => Promise<PendingAttachmentInput[]>;
  importPastedImage: (imageBuffer: ArrayBuffer, fileName: string, mimeType: string) => Promise<ImportedImageResult>;
  persistAttachments: (conversationId: string, attachments: PendingAttachmentInput[]) => Promise<PersistedAttachmentResult[]>;
  getConversationMessages: (conversationId: string) => Promise<AgentMessage[]>;
  getConversationMessagesPage: (conversationId: string, request: ConversationMessagesPageRequest) => Promise<ConversationMessagesPage>;
  resetConversation: (conversationId: string) => Promise<ConversationOperationResult>;
  reloadConversations: () => Promise<void>;
  getConversationsDirectory: () => Promise<string>;
  /** 打开会话时清零未读，返回被清掉的条数（>0 说明有新消息需要重载）。 */
  clearConversationUnread: (conversationId: string) => Promise<number>;
  /** 按 scope 聚合的未读数，用于侧边栏智能体/工程徽标。 */
  getConversationUnreadSummary: () => Promise<ConversationUnreadSummary>;
  /** 定时任务列表（缺省返回全部；传会话 id 只返回该会话的）。 */
  listScheduledTasks: (conversationId?: string) => Promise<ScheduledTask[]>;
  getMcpConfig: () => Promise<McpConfig>;
  listMcpServers: () => Promise<McpServerListItem[]>;
  saveMcpServer: (request: SaveMcpServerRequest) => Promise<McpOperationResult>;
  deleteMcpServer: (name: string) => Promise<McpOperationResult>;
  saveDefaultAgentMcpBinding: (binding: McpAgentBinding) => Promise<McpOperationResult>;
  getMcpConfigPath: () => Promise<string>;
  /** 用系统默认编辑器打开 mcp.json（缺失时先创建空配置），供用户手动编辑。 */
  openMcpConfigFile: () => Promise<void>;
  listMailAccounts: () => Promise<MailAccountListItem[]>;
  saveMailAccount: (input: MailAccountInput) => Promise<MailAccountOperationResult>;
  deleteMailAccount: (id: string) => Promise<MailAccountOperationResult>;
  setDefaultMailAccount: (id: string) => Promise<MailAccountOperationResult>;
  testMailAccount: (input: MailAccountInput) => Promise<MailTestResult>;
  testMailAccountById: (id: string) => Promise<MailTestResult>;
  getMailConfigPath: () => Promise<string>;
};
