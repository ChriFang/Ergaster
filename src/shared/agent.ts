import type { AttachmentMeta } from './attachment';
import type { UiWidgetPayload } from './ui-form';
import type { WorkflowMessageMeta } from './workflow';

export type ChatCompletionTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
};

export type DeepSeekTool = ChatCompletionTool;

export type AgentMessage = {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  attachments?: AttachmentMeta[];
  reasoning_content?: string;
  content_started?: boolean;
  tool_call_id?: string;
  name?: string;
  workflow?: WorkflowMessageMeta;
};

export type FilePreviewKind = 'image' | 'text' | 'docx';

export type ToolInvocationStatus = 'running' | 'success' | 'error';

/**
 * 工具调用推送到会话区的瞬时载荷。只走流事件，不进持久化，也不发给模型。
 * running 与后续 success/error 用同一个 toolCallId 对齐：前端按 id upsert，同一张卡片原地更新状态。
 */
export type ToolInvocationPayload = {
  /**
   * 产生该调用的那一轮用户消息 id。renderer 据此把卡片挂到该轮用户消息之后，
   * 与 filePreview 同规则；缺省或对不上时兜底挂在最后一条用户消息后。
   */
  turnUserId?: string;
  /** running 与终态事件用它对齐到同一张卡片。 */
  toolCallId: string;
  /**
   * 发起该调用的助手流式消息 id（发出 tool_calls 的那一轮 assistantMessageId）。
   * renderer 据此把卡片插在该助手消息之后、后续消息之前，按调用时序穿插进消息流；
   * 会话重载后中间助手消息被持久化过滤、锚点对不上时，回退按 turnUserId 挂到该轮用户消息之后。
   */
  assistantMessageId?: string;
  /** 工具名，如 http_request。 */
  name: string;
  /** 参数摘要（running 时给出，截断展示）。 */
  argsSummary?: string;
  status: ToolInvocationStatus;
  /** 完成时：工具是否成功。 */
  ok?: boolean;
  /** 完成时：compact 后的工具结果（JSON 字符串），renderer 解析后展示。 */
  resultContent?: string;
};

/** 预览工具推送到会话区的瞬时载荷。只走流事件，不进持久化，也不发给模型。 */
export type FilePreviewPayload = {
  kind: FilePreviewKind;
  fileName: string;
  path: string;
  /**
   * 产生该预览的那一轮用户消息 id。renderer 据此把卡片挂到该轮用户消息之后、助手回复之前，
   * 会话重载后消息 id 不变，卡片仍停在原来那一轮；缺省或对不上时兜底挂在最后一条用户消息后。
   */
  turnUserId?: string;
  /** image 类：data:<mime>;base64,... */
  dataUrl?: string;
  /** text 类：截断后的 UTF-8 文本 */
  text?: string;
  /** docx 类：mammoth 转出的 HTML，由 renderer 用 sandboxed iframe 渲染 */
  html?: string;
  truncated?: boolean;
};

export type AgentStreamEvent = {
  agentId?: string;
  /** 事件所属会话。renderer 据此只把 delta 应用到当前显示的会话，切走后不污染其他会话视图。 */
  conversationId?: string;
  streamMessageId?: string;
  deltaReasoningContent?: string;
  deltaContent?: string;
  done?: boolean;
  workflow?: WorkflowMessageMeta;
  /** 该流式消息最终对应的角色。缺省视为 assistant；工具结果需要显式标 tool 才能在界面上折叠。 */
  role?: 'assistant' | 'tool';
  /** 文件预览工具的瞬时预览载荷。设置后聊天会话把它渲染成预览卡片，不进消息列表。 */
  filePreview?: FilePreviewPayload;
  /** ui_form 工具的瞬时交互组件载荷。设置后聊天会话把它渲染成受控表单，不进消息列表。 */
  uiWidget?: UiWidgetPayload;
  /** 工具调用的瞬时状态载荷。设置后聊天会话把它渲染成工具调用卡片，不进消息列表。 */
  toolInvocation?: ToolInvocationPayload;
};

export type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type AgentResponse = {
  reply: string;
  messages: AgentMessage[];
  toolCalls: ToolCall[];
};

export type AgentConversationScope = {
  agentId?: string;
};

export type AgentRunInput = {
  prompt: string;
  promptForModel?: string;
  agentId?: string;
  conversationId: string;
  /** 代码分析模式：本次请求绑定的代码工程。设置后只启用只读的 code_* 工具。 */
  codeProjectId?: string;
  attachments?: Array<{
    localPath: string;
    meta: AttachmentMeta;
  }>;
};

export type CancelAgentResponse = {
  cancelled: boolean;
};
