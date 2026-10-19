import { getModelEffortOptions, type AppConfig, type ReasoningEffort } from '../../shared/config';

export function isDeepSeekEndpoint(baseUrl: string) {
  try {
    return /(^|\.)deepseek\.com$/i.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

/** 查不到该模型的配置时回落最低档 low；落盘值不在该模型档位集合内时同样回落。 */
export function resolveModelEffort(config: AppConfig, model: string): ReasoningEffort {
  const effort = config.reasoningEffortByModel?.[model] ?? 'low';
  return getModelEffortOptions(model).includes(effort) ? effort : 'low';
}

export type ReasoningRequestParams = {
  thinking?: { type: 'enabled' | 'disabled' };
  reasoning_effort?: ReasoningEffort;
};

/**
 * 组装思考相关的请求参数。
 * `reasoning_effort` 是 OpenAI 标准字段，one-api 等网关已在请求结构体中显式建模，
 * 透传/转换两条转发路径都会保留，故始终随请求顶层下发，不受 OneAPI 兼容开关、
 * 思考开关和端点影响（模型未配置档位时回落 low）。
 * `thinking` 是非 OpenAI 标准字段，必须落在请求体顶层——OpenAI SDK 里要靠
 * `extra_body` 注入并由 SDK 展开到顶层；我们手拼 JSON 直发，直接放顶层即可，
 * 切勿再包一层 `extra_body`（网关不识别会静默丢弃）。one-api 未在请求结构体中
 * 建模该字段，走其"转换"路径（模型 mapping、强制 system prompt 等）时会被
 * 反序列化静默丢弃，故仅在直连 DeepSeek 或未开兼容模式时下发。
 * 思考模式在 DeepSeek V4 默认开启，故关闭时需显式下发 disabled 才能真正关掉。
 */
export function buildReasoningParams(config: AppConfig): ReasoningRequestParams {
  const params: ReasoningRequestParams = {
    reasoning_effort: resolveModelEffort(config, config.model),
  };
  const thinkingSupported = !config.oneApiCompatibilityEnabled || isDeepSeekEndpoint(config.apiBaseUrl);
  if (thinkingSupported) {
    params.thinking = { type: config.thinkingModeEnabled ? 'enabled' : 'disabled' };
  }
  return params;
}
