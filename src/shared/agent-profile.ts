import type { McpAgentBinding } from './mcp';

export type AgentAvatarColor = 'cyan' | 'blue' | 'violet' | 'emerald' | 'amber' | 'rose';

/** 内置默认智能体的保留 id：首次启动种子创建，不允许删除。 */
export const DEFAULT_AGENT_ID = 'default';

export type AgentProfileListItem = {
  id: string;
  title: string;
  description: string;
  model: string;
  avatarColor: AgentAvatarColor;
  skillNames: string[];
  /** 是否允许该智能体使用 ui_form 交互表单工具（供 renderer 决定是否展示 /json-ui 指令）。 */
  uiDslEnabled: boolean;
  /** 是否允许该智能体使用 render_ui 交互式 HTML 工具（默认关）。 */
  uiHtmlEnabled: boolean;
  directoryName: string;
  directoryPath: string;
  createdAt: string;
  updatedAt: string;
  mcp: McpAgentBinding;
};

export type AgentProfileDetail = {
  id: string;
  title: string;
  description: string;
  model: string;
  avatarColor: AgentAvatarColor;
  skillNames: string[];
  /** 是否允许该智能体使用 ui_form 交互表单工具（第 1 层硬开关，默认开启）。 */
  uiDslEnabled: boolean;
  /** 是否允许该智能体使用 render_ui 交互式 HTML 工具（第 1 层硬开关，默认关闭）。 */
  uiHtmlEnabled: boolean;
  content: string;
  directoryName: string;
  directoryPath: string;
  createdAt: string;
  updatedAt: string;
  mcp: McpAgentBinding;
};

export type CreateAgentProfileRequest = {
  title: string;
  description: string;
  model: string;
  avatarColor: AgentAvatarColor;
  skillNames: string[];
  uiDslEnabled?: boolean;
  uiHtmlEnabled?: boolean;
  content: string;
  mcp?: McpAgentBinding;
};

export type UpdateAgentProfileRequest = {
  id: string;
  title: string;
  description: string;
  model: string;
  avatarColor: AgentAvatarColor;
  skillNames: string[];
  uiDslEnabled?: boolean;
  uiHtmlEnabled?: boolean;
  content: string;
  mcp?: McpAgentBinding;
};

export type AgentProfileOperationResult = {
  ok: boolean;
  error?: string;
  data?: AgentProfileDetail;
};

export type AgentProfileMetadata = {
  id: string;
  title: string;
  description: string;
  model: string;
  avatarColor: AgentAvatarColor;
  skillNames: string[];
  /** 是否允许该智能体使用 ui_form 交互表单工具（第 1 层硬开关，默认开启）。 */
  uiDslEnabled: boolean;
  /** 是否允许该智能体使用 render_ui 交互式 HTML 工具（第 1 层硬开关，默认关闭）。 */
  uiHtmlEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  mcp: McpAgentBinding;
};

export type AgentProfileRecord = {
  metadata: AgentProfileMetadata;
  content: string;
  directoryName: string;
  directoryPath: string;
  contentPath: string;
};
