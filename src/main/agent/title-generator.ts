import { appendMainLog } from '../core/audit-log';
import { loadConfig } from '../core/config-service';
import { createChatCompletion } from './deepseek-client';
import { buildFallbackTitle, buildTitleRequestContent, sanitizeGeneratedTitle } from './title-text-utils';

const TITLE_SYSTEM_PROMPT = '你是会话标题生成器。请根据给出的第一轮对话内容，用不超过 20 个字总结对话主题，作为会话标题。直接输出标题本身，不要加引号、句号或任何前后缀，不要解释。';

/**
 * 用模型总结首轮对话内容作为会话标题。
 * 任何失败（配置缺失、请求异常、返回为空）都回退为首条用户输入截断，保证会话总有可读标题。
 */
export async function generateConversationTitle(firstPrompt: string, assistantReply: string): Promise<string> {
  const fallbackTitle = buildFallbackTitle(firstPrompt);

  try {
    const config = await loadConfig();
    const result = await createChatCompletion({
      config,
      messages: [
        { role: 'system', content: TITLE_SYSTEM_PROMPT },
        { role: 'user', content: buildTitleRequestContent(firstPrompt, assistantReply) },
      ],
      tools: [],
      signal: AbortSignal.timeout(20_000),
    });

    return sanitizeGeneratedTitle(result.content ?? '', fallbackTitle);
  } catch (error) {
    await appendMainLog('WARN', `Failed to generate conversation title: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return fallbackTitle;
  }
}
