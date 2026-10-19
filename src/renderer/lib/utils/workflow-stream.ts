import type { AgentMessage } from '../../../shared/agent';
import type { WorkflowArtifact, WorkflowRun, WorkflowStreamEvent } from '../../../shared/workflow';

export function appendWorkflowStreamDelta(messages: AgentMessage[], event: WorkflowStreamEvent): AgentMessage[] {
  if (!event.streamMessageId || (!event.deltaContent && !event.deltaReasoningContent)) {
    return messages;
  }

  const existingIndex = messages.findIndex((message) => message.id === event.streamMessageId);
  if (existingIndex < 0) {
    return [
      ...messages,
      {
        id: event.streamMessageId,
        // 工具结果必须落成 tool 角色，否则会被当成 assistant 正文整段铺开
        role: event.role ?? 'assistant',
        content: event.deltaContent ?? '',
        reasoning_content: event.deltaReasoningContent,
        content_started: Boolean(event.deltaContent),
        workflow: event.workflow,
      },
    ];
  }

  return messages.map((message, index) => {
    if (index !== existingIndex) {
      return message;
    }

    return {
      ...message,
      content: `${message.content}${event.deltaContent ?? ''}`,
      reasoning_content: `${message.reasoning_content ?? ''}${event.deltaReasoningContent ?? ''}` || undefined,
      content_started: message.content_started || Boolean(event.deltaContent),
      workflow: message.workflow ?? event.workflow,
    };
  });
}

export function mergeRunSnapshot(current: WorkflowRun | null, snapshot: WorkflowRun) {
  if (!current) {
    return snapshot;
  }

  const streamingMessagesById = new Map(current.messages.filter((message) => message.id).map((message) => [message.id, message]));
  const messages = snapshot.messages.map((message) => {
    const streamingMessage = message.id ? streamingMessagesById.get(message.id) : undefined;
    if (!streamingMessage) {
      return message;
    }

    if (message.content || message.reasoning_content) {
      return message;
    }

    return streamingMessage;
  });

  // 合并 artifacts：若快照与本地 id 集合完全一致，保留本地数组引用，让 memo 跳过重渲染；
  // 否则以本地为基础，用快照更新同 id 项、追加新增。
  const currentArtifactIds = new Set(current.artifacts.map((artifact) => artifact.id));
  const snapshotArtifactIds = new Set(snapshot.artifacts.map((artifact) => artifact.id));
  const sameIdSet = currentArtifactIds.size === snapshotArtifactIds.size
    && [...currentArtifactIds].every((id) => snapshotArtifactIds.has(id));

  let artifacts: WorkflowArtifact[];
  if (sameIdSet) {
    // id 集合不变，保留本地引用 —— memo 浅比较命中同一数组，跳过重渲染
    artifacts = current.artifacts;
  } else {
    const snapshotArtifactsById = new Map(snapshot.artifacts.map((artifact) => [artifact.id, artifact]));
    artifacts = current.artifacts.map((artifact) => snapshotArtifactsById.get(artifact.id) ?? artifact);
    for (const artifact of snapshot.artifacts) {
      if (!currentArtifactIds.has(artifact.id)) {
        artifacts.push(artifact);
      }
    }
  }

  return { ...snapshot, messages, artifacts };
}
