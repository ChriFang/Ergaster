import type { ChatCompletionApiMessage } from '../agent/deepseek-client';

/**
 * 按消息 id 截断会话：保留该消息**之前**的内容，删除该消息及其后所有内容。
 * 用于「撤销会话」——从某条消息回退上下文。
 *
 * 返回截断后的新数组；未找到 messageId 时返回 null，由调用方决定如何提示。
 * 不修改传入数组。
 */
export function truncateMessagesFromId(
  messages: ChatCompletionApiMessage[],
  messageId: string,
): ChatCompletionApiMessage[] | null {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    return null;
  }
  return messages.slice(0, index);
}
