import type { AgentMessage, AgentStreamEvent } from '../../../shared/agent';

export function matchesStreamEventAgent(event: AgentStreamEvent, selectedAgentId: string | null) {
  // 工作流事件（带 workflow 元数据）不应进入聊天会话的 stream 处理，
  // 否则工作流消息会泄漏到 useChatSession.messages
  if (event.workflow) {
    return false;
  }

  return (event.agentId ?? null) === selectedAgentId;
}

/**
 * 事件是否属于当前正在显示的会话。
 * 事件带 conversationId 时以它为准（切走原会话后，旧会话的流不再污染新会话视图）；
 * 兼容不带 conversationId 的旧事件：回退为 true，交由 agent 维度过滤兜底。
 */
export function matchesStreamEventConversation(event: AgentStreamEvent, activeConversationId: string | null) {
  if (!event.conversationId) {
    return true;
  }
  return event.conversationId === activeConversationId;
}

export function appendAssistantStreamDelta(currentMessages: AgentMessage[], event: AgentStreamEvent) {
  if (!event.streamMessageId) {
    return currentMessages;
  }

  const assistantMessageIndex = currentMessages.findIndex((message) => message.id === event.streamMessageId);

  if (assistantMessageIndex === -1) {
    return [
      ...currentMessages,
      {
        id: event.streamMessageId,
        role: 'assistant' as const,
        content: event.deltaContent ?? '',
        reasoning_content: event.deltaReasoningContent ?? '',
        content_started: event.deltaContent !== undefined,
      },
    ];
  }

  const assistantMessage = currentMessages[assistantMessageIndex];
  if (assistantMessage.role !== 'assistant') {
    return currentMessages;
  }

  const updatedAssistantMessage: AgentMessage = {
    ...assistantMessage,
    content: `${assistantMessage.content}${event.deltaContent ?? ''}`,
    reasoning_content: `${assistantMessage.reasoning_content ?? ''}${event.deltaReasoningContent ?? ''}`,
    content_started: assistantMessage.content_started === true || event.deltaContent !== undefined,
  };

  const nextMessages = [...currentMessages];
  nextMessages[assistantMessageIndex] = updatedAssistantMessage;
  return nextMessages;
}

export function getLatestStreamingAssistantMessage(messages: AgentMessage[]) {
  let latestUserMessageIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      latestUserMessageIndex = index;
      break;
    }
  }

  for (let index = messages.length - 1; index > latestUserMessageIndex; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') {
      continue;
    }

    const hasReasoning = (message.reasoning_content?.trim() ?? '').length > 0;
    const hasContentStarted = message.content_started === true || message.content.length > 0;
    if (hasReasoning || hasContentStarted) {
      return message;
    }
  }

  return null;
}
