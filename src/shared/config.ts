export type ToolSettings = {
  allowedPaths?: string[];
  searchRoots?: string[];
  draftDirectory?: string;
  /**
   * 命令自动执行白名单：按命令前缀匹配（如 `git` 放行所有 git 子命令，`git status` 只放行该子命令），
   * 命中后 run_command 不再弹确认卡。仅对交互式会话生效；存储统一小写。
   */
  commandAllowlist?: string[];
  /** 命令黑名单：优先级最高，命中即强制弹窗确认，且弹窗不提供「总是允许此命令」勾选。存储统一小写。 */
  commandDenylist?: string[];
  /** 全局「允许自动执行的工具」清单：命中的系统工具（非 high）调用不再弹确认卡。存工具名原样（小写标识符）。 */
  autoExecuteTools?: string[];
  /**
   * download_file 的下载域名白名单：主机名精确匹配（小写），命中则下载不弹确认卡。
   * 默认空；确认卡勾选「总是允许此域名」时追加。无人值守链路只允许白名单内域名。
   */
  downloadAllowedHosts?: string[];
};

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const ALL_REASONING_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** 各模型可用的思考强度档位集合：规则集中在此，后续按模型家族扩展。 */
export function getModelEffortOptions(model: string): ReasoningEffort[] {
  // Opus 系（如 claude-opus-4.8）支持五档；GPT 系为四档 low/medium/high/xhigh（无 max）；其余（含 DeepSeek 全系）保持三档
  if (/opus/i.test(model)) {
    return ALL_REASONING_EFFORTS;
  }
  if (/gpt/i.test(model)) {
    return ['low', 'medium', 'high', 'xhigh'];
  }
  return ['low', 'high', 'max'];
}

/** 窗口关闭按钮（X）的行为：ask 每次弹窗询问；minimize 最小化到托盘；exit 直接退出。 */
export type WindowCloseAction = 'ask' | 'minimize' | 'exit';

/** resolveCloseBehavior 的结果：native 表示交给平台默认行为（mac 关窗不退出）。 */
export type CloseBehavior = 'ask' | 'minimize' | 'exit' | 'native';

const WINDOW_CLOSE_ACTIONS: readonly WindowCloseAction[] = ['ask', 'minimize', 'exit'];

export type AppConfig = {
  deepseekApiKey: string;
  githubToken: string;
  model: string;
  apiBaseUrl: string;
  maxToolRounds: number;
  thinkingModeEnabled: boolean;
  /** 是否启用全局长期记忆（注入 + memory_* 工具 + 节流自动抽取）。默认开启。 */
  memoryEnabled: boolean;
  /** 已添加的扩展能力 id 列表（如 'mail'）。空表示未添加任何扩展；对应能力的工具与设置项据此门控。默认空。 */
  enabledExtensions: string[];
  reasoningEffortByModel: Record<string, ReasoningEffort>;
  oneApiCompatibilityEnabled: boolean;
  contextWindowSize: number;
  /** 模型流式响应的空闲超时（秒）：连续这么久没有收到新数据才判定超时，长回复本身不受限制。 */
  modelIdleTimeoutSeconds: number;
  /** 点窗口关闭按钮（X）的行为；托盘常驻（仅 Windows 创建托盘）。 */
  closeAction: WindowCloseAction;
  toolSettings?: ToolSettings;
};

export const minModelIdleTimeoutSeconds = 30;
export const maxModelIdleTimeoutSeconds = 900;

/** 单次请求内工具调用轮数的取值范围；默认值见 defaultConfig.maxToolRounds。 */
export const minToolRounds = 1;
export const maxToolRounds = 1024;

export const defaultConfig: AppConfig = {
  deepseekApiKey: '',
  githubToken: '',
  model: 'deepseek-v4-pro',
  apiBaseUrl: 'https://api.deepseek.com',
  maxToolRounds: 256,
  thinkingModeEnabled: false,
  memoryEnabled: true,
  enabledExtensions: [],
  reasoningEffortByModel: {},
  oneApiCompatibilityEnabled: false,
  contextWindowSize: 128000,
  modelIdleTimeoutSeconds: 180,
  closeAction: 'ask',
  toolSettings: {},
};

export const configFileName = 'config.json';

function sanitizeStringArray(values: string[] | undefined) {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const sanitized = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

  return sanitized.length > 0 ? sanitized : undefined;
}

/** 命令清单清洗：trim + 小写化（PowerShell 大小写不敏感）+ 去重。 */
function sanitizeCommandList(values: string[] | undefined) {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const seen = new Set<string>();
  const sanitized = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });

  return sanitized.length > 0 ? sanitized : undefined;
}

/** 合法主机名：字母数字与连字符组成的点分标签（不含端口、协议、路径与通配符）。 */
const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** 规范化单个下载域名：trim + 小写，非法主机名返回空串。 */
export function normalizeDownloadHost(value: string): string {
  const host = value.trim().toLowerCase();
  return HOSTNAME_PATTERN.test(host) ? host : '';
}

/** 下载域名白名单清洗：trim + 小写 + 去重，丢弃非法主机名。 */
function sanitizeHostList(values: string[] | undefined) {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const seen = new Set<string>();
  const sanitized = values
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeDownloadHost)
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });

  return sanitized.length > 0 ? sanitized : undefined;
}

function sanitizeToolSettings(toolSettings: ToolSettings | undefined) {
  if (!toolSettings) {
    return undefined;
  }

  return {
    allowedPaths: sanitizeStringArray(toolSettings.allowedPaths),
    searchRoots: sanitizeStringArray(toolSettings.searchRoots),
    draftDirectory:
      typeof toolSettings.draftDirectory === 'string' && toolSettings.draftDirectory.trim()
        ? toolSettings.draftDirectory.trim()
        : undefined,
    commandAllowlist: sanitizeCommandList(toolSettings.commandAllowlist),
    commandDenylist: sanitizeCommandList(toolSettings.commandDenylist),
    autoExecuteTools: sanitizeStringArray(toolSettings.autoExecuteTools),
    downloadAllowedHosts: sanitizeHostList(toolSettings.downloadAllowedHosts),
  } satisfies ToolSettings;
}

function sanitizeReasoningEffortByModel(input: unknown): Record<string, ReasoningEffort> {
  const allowed = ALL_REASONING_EFFORTS;
  if (!input || typeof input !== 'object') {
    return {};
  }

  const out: Record<string, ReasoningEffort> = {};
  for (const [model, effort] of Object.entries(input as Record<string, unknown>)) {
    const key = model.trim();
    if (key && allowed.includes(effort as ReasoningEffort)) {
      out[key] = effort as ReasoningEffort;
    }
  }
  return out;
}

function sanitizeCloseAction(value: unknown): WindowCloseAction {
  return WINDOW_CLOSE_ACTIONS.includes(value as WindowCloseAction)
    ? (value as WindowCloseAction)
    : defaultConfig.closeAction;
}

export function sanitizeConfig(input: Partial<AppConfig> | null | undefined): AppConfig {
  const toolRounds = Number(input?.maxToolRounds ?? defaultConfig.maxToolRounds);
  const contextWindowSize = Number(input?.contextWindowSize ?? defaultConfig.contextWindowSize);
  const modelIdleTimeoutSeconds = Number(input?.modelIdleTimeoutSeconds ?? defaultConfig.modelIdleTimeoutSeconds);

  return {
    deepseekApiKey: typeof input?.deepseekApiKey === 'string' ? input.deepseekApiKey.trim() : defaultConfig.deepseekApiKey,
    githubToken: typeof input?.githubToken === 'string' ? input.githubToken.trim() : defaultConfig.githubToken,
    model: typeof input?.model === 'string' && input.model.trim() ? input.model.trim() : defaultConfig.model,
    apiBaseUrl:
      typeof input?.apiBaseUrl === 'string' && input.apiBaseUrl.trim()
        ? input.apiBaseUrl.trim()
        : defaultConfig.apiBaseUrl,
    maxToolRounds: Number.isFinite(toolRounds) ? Math.min(Math.max(Math.round(toolRounds), minToolRounds), maxToolRounds) : defaultConfig.maxToolRounds,
    thinkingModeEnabled: typeof input?.thinkingModeEnabled === 'boolean' ? input.thinkingModeEnabled : defaultConfig.thinkingModeEnabled,
    memoryEnabled: typeof input?.memoryEnabled === 'boolean' ? input.memoryEnabled : defaultConfig.memoryEnabled,
    enabledExtensions: sanitizeStringArray(input?.enabledExtensions) ?? [],
    reasoningEffortByModel: sanitizeReasoningEffortByModel(input?.reasoningEffortByModel),
    oneApiCompatibilityEnabled:
      typeof input?.oneApiCompatibilityEnabled === 'boolean' ? input.oneApiCompatibilityEnabled : defaultConfig.oneApiCompatibilityEnabled,
    contextWindowSize: Number.isFinite(contextWindowSize) ? Math.min(Math.max(Math.round(contextWindowSize), 4096), 1_000_000) : defaultConfig.contextWindowSize,
    modelIdleTimeoutSeconds: Number.isFinite(modelIdleTimeoutSeconds)
      ? Math.min(Math.max(Math.round(modelIdleTimeoutSeconds), minModelIdleTimeoutSeconds), maxModelIdleTimeoutSeconds)
      : defaultConfig.modelIdleTimeoutSeconds,
    closeAction: sanitizeCloseAction(input?.closeAction),
    toolSettings: sanitizeToolSettings(input?.toolSettings),
  };
}

/** 决定点窗口关闭按钮的去向：mac 走平台默认（关窗不退出）；win32 按配置（托盘常驻）。 */
export function resolveCloseBehavior(closeAction: WindowCloseAction, platform: string): CloseBehavior {
  if (platform !== 'win32') {
    return 'native';
  }

  return closeAction;
}

/** 掩码密钥用于回显：短值全掩码，长值保留首尾 4 位。 */
function maskSecret(value: string): string {
  return value.length <= 8
    ? '*'.repeat(value.length)
    : `${value.slice(0, 4)}${'*'.repeat(Math.max(value.length - 8, 0))}${value.slice(-4)}`;
}

export function toMaskedConfig(config: AppConfig) {
  // 原文密钥不下发到 renderer，仅回传掩码串与「是否已配置」标记。
  const { deepseekApiKey, githubToken, ...rest } = config;

  return {
    ...rest,
    maskedApiKey: maskSecret(deepseekApiKey),
    hasApiKey: deepseekApiKey.length > 0,
    maskedGithubToken: maskSecret(githubToken),
    hasGithubToken: githubToken.length > 0,
  };
}

export type MaskedAppConfig = ReturnType<typeof toMaskedConfig>;
