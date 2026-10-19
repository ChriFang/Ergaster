import type { ChatCompletionApiMessage, ChatContentPart } from './deepseek-client';

/**
 * 把本轮用户消息的 content 替换为发给模型的多模态/附件增强内容（`userContentForModel`）。
 *
 * 按消息 id 精确匹配本轮用户消息，而不是"最后一条 user 消息"：一旦本轮发生工具调用，
 * 消息尾部会追加 assistant(tool_calls)/tool 消息，按位置注入会让第 2 轮起图片/附件
 * 从上下文丢失，模型据此误判"只收到文字"。按 id 匹配保证附件内容贯穿本轮所有轮次。
 *
 * turnUserId 为空时不做任何注入，原样返回。
 */
export function injectTurnUserContent(
  messages: ChatCompletionApiMessage[],
  turnUserId: string | undefined,
  content: string | ChatContentPart[],
): ChatCompletionApiMessage[] {
  if (!turnUserId) {
    return messages;
  }

  return messages.map((message) =>
    message.id === turnUserId ? { ...message, content } : message,
  );
}
