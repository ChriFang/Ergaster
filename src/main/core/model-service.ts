import type { AppConfig } from '../../shared/config';

type ModelsResponse = {
  data?: Array<{ id?: string }>;
  error?: { message?: string };
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

async function parseErrorText(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return `HTTP ${response.status} ${response.statusText}`;
  }

  try {
    const payload = JSON.parse(text) as ModelsResponse;
    return payload.error?.message || `HTTP ${response.status} ${text}`;
  } catch {
    return `HTTP ${response.status} ${text}`;
  }
}

// DeepSeek 直连（GET {base}/models）与 One API（GET {base}/v1/models）同为 OpenAI 兼容接口，
// 返回结构一致。现有 chat/completions 用的是 `${base}/chat/completions`，此处 `/models` 与之同构。
// 兜底再试一次 `/v1/models`，覆盖仅注册 /v1 路由的 One API 部署。
export async function listAvailableModels(config: AppConfig): Promise<string[]> {
  if (!config.deepseekApiKey) {
    throw new Error('请先在设置中配置 API Key。');
  }

  if (!config.apiBaseUrl) {
    throw new Error('请先在设置中配置 API Base URL。');
  }

  const base = normalizeBaseUrl(config.apiBaseUrl);
  const candidates = [`${base}/models`, `${base}/v1/models`];

  let lastError = '';

  for (const url of candidates) {
    let response: Response;

    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${config.deepseekApiKey}` },
      });
    } catch (error) {
      lastError = `无法连接服务：${(error as Error).message}`;
      continue;
    }

    if (!response.ok) {
      lastError = await parseErrorText(response);
      continue;
    }

    const payload = (await response.json()) as ModelsResponse;
    const ids = (payload.data ?? [])
      .map((model) => (typeof model?.id === 'string' ? model.id.trim() : ''))
      .filter((id): id is string => Boolean(id));

    return Array.from(new Set(ids)).sort();
  }

  throw new Error(`获取模型列表失败：${lastError || '请检查 API Base URL 与 Key。'}`);
}
