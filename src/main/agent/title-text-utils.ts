export const DEFAULT_CONVERSATION_TITLE = '新会话';

const TITLE_MAX_LENGTH = 30;
const TITLE_SOURCE_MAX_LENGTH = 500;
const FALLBACK_TITLE_MAX_LENGTH = 80;

/** 把首轮用户输入与助手回复拼成标题生成的请求正文，超长截断。 */
export function buildTitleRequestContent(firstPrompt: string, assistantReply: string): string {
  const prompt = firstPrompt.replace(/\s+/g, ' ').trim().slice(0, TITLE_SOURCE_MAX_LENGTH);
  const reply = assistantReply.replace(/\s+/g, ' ').trim().slice(0, TITLE_SOURCE_MAX_LENGTH);

  return [
    `用户输入：${prompt || '（无文本内容）'}`,
    `助手回复：${reply || '（无文本内容）'}`,
  ].join('\n');
}

/** 清洗模型返回的标题：去掉引号、常见前后缀与结尾标点，超长截断；无效时回退。 */
export function sanitizeGeneratedTitle(rawTitle: string, fallbackTitle: string): string {
  const cleaned = rawTitle
    .trim()
    .replace(/^["'“”‘’「」『』【《〈]+/, '')
    .replace(/["'“”‘’「」『』【《〈》〉】』」]+$/, '')
    .replace(/^(?:标题|主题|会话标题)\s*[:：]\s*/, '')
    .replace(/[.。！!？?；;，,\s]+$/, '')
    .trim();

  const title = cleaned.slice(0, TITLE_MAX_LENGTH).trim();
  return title || fallbackTitle.trim().slice(0, FALLBACK_TITLE_MAX_LENGTH).trim() || DEFAULT_CONVERSATION_TITLE;
}

/** 标题生成失败时的回退标题：首条用户输入截断。 */
export function buildFallbackTitle(firstPrompt: string): string {
  return firstPrompt.slice(0, FALLBACK_TITLE_MAX_LENGTH) || DEFAULT_CONVERSATION_TITLE;
}
