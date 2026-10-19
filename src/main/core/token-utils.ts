import type { ChatCompletionApiMessage } from '../agent/deepseek-client';

/**
 * Estimate token count for OpenAI-compatible APIs.
 *
 * - CJK characters: ~1.5 tokens each
 * - ASCII characters: ~0.25 tokens each (4 chars per token)
 * - Other Unicode: ~0.5 tokens each
 *
 * Conservative overestimate by ~15% to avoid late summarization.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(scoreTokens(text));
}

/**
 * 与 estimateTokenCount 同一套权重，但不向上取整。
 *
 * 流式增量每次只有几个字符，逐段 Math.ceil 会把误差放大成好几倍
 * （100 段 2 字符的增量会被算成 100 token）。累加场景必须用未取整的分值，
 * 只在最终展示时取整。
 */
export function scoreTokens(text: string): number {
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0x3040 && code <= 0x309F) ||
      (code >= 0x30A0 && code <= 0x30FF) ||
      (code >= 0xAC00 && code <= 0xD7AF) ||
      (code >= 0xF900 && code <= 0xFAFF)
    ) {
      count += 1.5;
    } else if (code <= 0x7F) {
      count += 0.25;
    } else {
      count += 0.5;
    }
  }
  return count;
}

/**
 * 取出消息正文里可计数的文本。
 *
 * content 可能是多模态数组（图片附件场景），直接丢给按字符遍历的估算函数会抛错，
 * 这里只累计其中的 text 片段。
 */
function toCountableText(content: ChatCompletionApiMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

/**
 * Estimate total tokens for a list of API messages.
 * Includes role overhead (~4 tokens per message for formatting).
 */
export function estimateMessagesTokenCount(messages: ChatCompletionApiMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += 4;
    if (msg.content) {
      total += estimateTokenCount(toCountableText(msg.content));
    }
    if (msg.reasoning_content) {
      total += estimateTokenCount(msg.reasoning_content);
    }
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokenCount(tc.function.name + tc.function.arguments);
      }
    }
  }
  return total;
}
