import type { z } from 'zod';
import type { FilePreviewPayload } from './agent';
import type { UiWidgetPayload } from './ui-form';
import type { WorkflowMessageMeta } from './workflow';

export type ToolRisk = 'low' | 'medium' | 'high';

/** 工具执行的默认超时。适合读文件、查信息这类快操作。 */
export const defaultToolTimeoutMs = 20_000;
/** 执行任意命令类工具的超时。批量下载、打包这类操作 10 秒远远不够。 */
export const commandToolTimeoutMs = 300_000;
/** 派发子智能体的超时。子智能体内部会自己跑多轮工具，需要留足时间。 */
export const subagentToolTimeoutMs = 600_000;
/** 代码工程全量检索的超时。大工程遍历比读单个文件慢得多。 */
export const codeToolTimeoutMs = 30_000;
/** 邮件（IMAP）工具的超时。含网络握手、认证与抓取，比本地读文件慢。 */
export const mailToolTimeoutMs = 30_000;

/** 下载工具名：审批走下载域名白名单，不受「允许自动执行的工具」清单影响。 */
export const downloadToolName = 'download_file';


export type ToolResult = {
  ok: boolean;
  content: string;
  /**
   * 工具返回的图片（data URL，如 MCP 多模态结果里的截图）。
   * 以 image_url 内容块随工具消息发给模型，不再把 base64 当文本注入；
   * 同时路由到 emitFilePreview 让用户在会话区直接看到。
   */
  images?: string[];
  data?: unknown;
  error?: string;
};

export type ToolConfirmationRequest = {
  toolName: string;
  risk: ToolRisk;
  summary: string;
  /** 补充说明，例如将要写入的目标文件与影响范围。 */
  detail?: string;
  /** unified diff 文本。写文件类工具必须提供，避免用户在看不到改动的情况下批准。 */
  diff?: string;
  /** 是否展示"自动运行并记住"勾选（仅系统工具且非 high 风险）。 */
  canAutoRun?: boolean;
  /**
   * 命令类工具专有：建议加入命令白名单的前缀（如 `git status`）。
   * 非空时确认卡展示「总是允许此命令」勾选；命中黑名单/危险模式时不提供（保持为空）。
   */
  commandAutoAllow?: string;
  /**
   * download_file 专有：不在下载白名单内的主机名。
   * 非空时确认卡展示「总是允许此域名」勾选；勾选并确认后写入下载域名白名单。
   */
  domainAutoAllow?: string;
};

/** 确认弹窗的裁决结果：approved 之外可携带"记住自动运行"或"把命令加入白名单"。 */
export type ToolConfirmationOutcome = {
  approved: boolean;
  autoRun?: boolean;
  /** 勾选「总是允许此命令」时为 true，主进程据此把 commandAutoAllow 前缀写入全局白名单。 */
  autoAllowCommand?: boolean;
  /** 勾选「总是允许此域名」时为 true，主进程据此把 domainAutoAllow 写入下载域名白名单。 */
  autoAllowDomain?: boolean;
};

/** renderer 回传确认结果的载荷（tool:confirm-response）。 */
export type ToolConfirmationResponsePayload = {
  approved: boolean;
  autoRun?: boolean;
  autoAllowCommand?: boolean;
  autoAllowDomain?: boolean;
};

/**
 * 工具审批模式。
 * - interactive：默认，按智能体清单与风险等级决定是否弹确认；
 * - unattended-safe：无人值守链路（定时任务），low/medium 自动放行、high 直接拒绝。
 */
export type ToolApprovalMode = 'interactive' | 'unattended-safe';

/** 工具目录条目：供智能体编辑器的"允许自动执行"清单展示。 */
export type SystemToolCatalogItem = {
  name: string;
  description: string;
  risk: ToolRisk;
};

export type ToolContext = {
  signal: AbortSignal;
  requestUserConfirmation: (input: ToolConfirmationRequest) => Promise<ToolConfirmationOutcome>;
  /** 发起本次调用的 agent id。派发子智能体时用于继承 skill / mcp 工具边界。 */
  agentId?: string;
  /** 当前调用所处的子智能体嵌套深度，0 表示主智能体。用于阻断无限递归派发。 */
  depth?: number;
  /** 工作流上下文，用于把子智能体的流式输出挂回正确的 stage / actor。 */
  workflowMeta?: WorkflowMessageMeta;
  /** 当前代码工程的根目录绝对路径。仅 code_* 工具使用，作为其唯一可访问边界。 */
  codeProjectRoot?: string;
  /** 当前代码工程 id，用于审计日志与状态归属。 */
  codeProjectId?: string;
  /** 当前代码工程是否允许修改。为 false 时写入类工具不会注册进工具集。 */
  codeProjectWritable?: boolean;
  /** 当前会话 id。写入前备份与"读过才可写"的追踪都按会话归属。 */
  conversationId?: string;
  /** 把文件预览载荷推送到聊天会话区的瞬时通道。缺省实现为 no-op（如 skill 工具路径）。 */
  emitFilePreview?: (payload: FilePreviewPayload) => void;
  /** 把交互组件（ui_form）载荷推送到聊天会话区的瞬时通道。缺省实现为 no-op。 */
  emitUiWidget?: (payload: UiWidgetPayload) => void;
};

export type ToolSchemaShape = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
};

export type ToolDefinition<TArgs> = {
  name: string;
  description: string;
  risk: ToolRisk;
  strict: true;
  parameters: ToolSchemaShape;
  validator: z.ZodType<TArgs>;
  /** 单次执行超时（毫秒）。省略时使用注册表的默认值。 */
  timeoutMs?: number;
  /**
   * 展示型工具：只在会话区渲染 UI、不产生副作用（如 ui_form）。
   * 低风险的系统级展示工具跳过确认弹窗——渲染一个表单还要先点“允许”很荒谬。
   */
  presentational?: true;
  execute: (args: TArgs, context: ToolContext) => Promise<ToolResult>;
  /**
   * 确认弹窗的预览内容。中高风险工具可实现此钩子，在用户批准前展示实际影响（如 diff）。
   * 抛错表示这次调用在预检阶段就不合法，会直接作为工具错误返回而不弹窗。
   */
  buildConfirmation?: (args: TArgs, context: ToolContext) => Promise<{ summary?: string; detail?: string; diff?: string }>;
  source?: {
    type: 'system' | 'skill' | 'mcp';
    serverName?: string;
    skillName?: string;
  };
};

export type ToolAuditEntry = {
  timestamp: string;
  toolName: string;
  risk: ToolRisk;
  status: 'success' | 'error' | 'cancelled';
  summary: string;
  detail: string;
};

export type AgentAuditEntry = {
  timestamp: string;
  status: 'started' | 'success' | 'error' | 'cancelled';
  summary: string;
  detail: string;
};
