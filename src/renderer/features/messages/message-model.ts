import type { AgentMessage } from '../../../shared/agent';

export type ToolMessagePayload = {
  ok: boolean;
  content: string;
  data?: unknown;
  error?: string;
  summary?: string;
};

export type MessageBodyModel = {
  kind: 'markdown' | 'plain';
  text: string;
};

export function parseToolMessage(content: string): ToolMessagePayload | null {
  try {
    const parsed = JSON.parse(content) as ToolMessagePayload;
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.ok === 'boolean') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function getToolDisplayText(payload: ToolMessagePayload) {
  if (payload.error) {
    return payload.error;
  }

  if (payload.content) {
    return payload.content;
  }

  if (payload.data !== undefined) {
    return JSON.stringify(payload.data, null, 2);
  }

  return '工具已完成，但没有返回额外内容。';
}

export function getAssistantReasoningText(message: AgentMessage) {
  return message.role === 'assistant' ? (message.reasoning_content?.trim() ?? '') : '';
}

export function hasAssistantReasoning(message: AgentMessage) {
  return getAssistantReasoningText(message).length > 0;
}

export function getMessageBodyModel(message: AgentMessage, toolPayload: ToolMessagePayload | null): MessageBodyModel {
  if (message.role === 'assistant') {
    return {
      kind: 'markdown',
      text: message.content,
    };
  }

  if (message.role === 'tool' && toolPayload) {
    if (toolPayload.error) {
      return {
        kind: 'markdown',
        text: toolPayload.error,
      };
    }

    if (toolPayload.content) {
      return {
        kind: 'markdown',
        text: toolPayload.content,
      };
    }

    if (toolPayload.data !== undefined) {
      return {
        kind: 'plain',
        text: JSON.stringify(toolPayload.data, null, 2),
      };
    }

    return {
      kind: 'markdown',
      text: '工具已完成，但没有返回额外内容。',
    };
  }

  return {
    kind: 'plain',
    text: message.content,
  };
}

export function getRoleLabel(message: AgentMessage) {
  if (message.role === 'assistant') {
    return '助手';
  }

  if (message.role === 'user') {
    return '用户';
  }

  return '工具';
}

export function getMessageKey(message: AgentMessage, index: number) {
  return message.id ?? `${message.role}-${index}-${message.tool_call_id ?? 'message'}`;
}

export function getCollapsedPreviewText(text: string) {
  const normalized = text.replace(/\r\n/g, '\n');
  const firstLine = normalized.split('\n')[0]?.trim();
  return firstLine || '工具已完成，但没有返回额外内容。';
}

/** 预览卡片参与身份判定所需的最小字段。 */
export type FilePreviewLike = {
  turnUserId?: string;
  kind: string;
  path: string;
  fileName: string;
};

/**
 * 预览卡片的身份。同一轮里再次预览同一目标视为同一张卡片（替换而非追加），
 * 避免模型连续调用刷出一串重复图；不同轮各自留一张，方便对照每轮的结果。
 * 多模态工具结果的图片没有落盘路径（path 为空），用 fileName 区分同一次调用里的多张图。
 */
export function getFilePreviewKey(item: FilePreviewLike) {
  return `${item.turnUserId ?? ''}::${item.kind}::${item.path}::${item.fileName}`;
}

/** 按产生卡片的轮次（用户消息 id）归组；缺 turnUserId 的（异常路径）由调用方兜底。 */
export function groupFilePreviewsByTurnUserId<T extends FilePreviewLike>(items: readonly T[]) {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    if (!item.turnUserId) {
      continue;
    }

    const bucket = grouped.get(item.turnUserId);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(item.turnUserId, [item]);
    }
  }

  return grouped;
}

/** 交互组件参与归组所需的最小字段。 */
export type TurnAnchoredLike = {
  turnUserId?: string;
};

/** computeTurnLastEntryKey 的输入：一个渲染条目的 key，以及它若为用户消息则带上该消息 id。 */
export type TurnBoundaryEntry = {
  key: string;
  /** 是否用户消息条目。乐观插入的用户消息尚未落盘、无 id，但同样开启新的一轮。 */
  isUserMessage?: boolean;
  /** 仅当该条目是带 id 的用户消息时设置；标志着新一轮的开始。 */
  userMessageId?: string;
};

/**
 * 计算每一轮（turnUserId）的「最后一个条目 key」。
 * 一轮从某条用户消息开始，到下一条用户消息之前结束；文件预览挂在该 key 之后，
 * 就落在本轮的命令/助手消息再往后，即"在一次对话的最后显示"，不再夹在中间。
 * 遍历中用后出现的条目持续覆盖当前轮的记录，循环结束时每轮停在它的最后一个条目。
 * 乐观插入的用户消息（run 进行中、尚未落盘、无 id）同样终结上一轮归属：
 * 否则上一轮的「最后条目」会越过这条消息漂到新回复之后，把上一轮的交互组件
 * （如 HTML 表单）拖到本轮推理/回复的下面，大卡片盖住新输出。
 */
export function computeTurnLastEntryKey(entries: readonly TurnBoundaryEntry[]) {
  const lastKeyByTurn = new Map<string, string>();
  let currentTurn: string | undefined;

  for (const entry of entries) {
    if (entry.userMessageId || entry.isUserMessage) {
      // 无 id 的乐观用户消息把 currentTurn 置空：后续条目不归属任何已渲染的轮
      currentTurn = entry.userMessageId;
    }
    if (currentTurn) {
      lastKeyByTurn.set(currentTurn, entry.key);
    }
  }

  return lastKeyByTurn;
}

/** 按产生组件的轮次（用户消息 id）归组；与文件预览同构，缺 turnUserId 的由调用方兜底。 */
export function groupByTurnUserId<T extends TurnAnchoredLike>(items: readonly T[]) {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    if (!item.turnUserId) {
      continue;
    }

    const bucket = grouped.get(item.turnUserId);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(item.turnUserId, [item]);
    }
  }

  return grouped;
}

/** 时序穿插的工具调用卡片参与交错所需的最小字段。 */
export type ToolInvocationLike = {
  id: string;
  turnUserId?: string;
  /** 发起该调用的助手流式消息 id（锚点）；会话重载后中间助手消息被持久化过滤时对不上。 */
  assistantMessageId?: string;
};

/**
 * 把工具调用卡片按调用时序交错进消息条目流。
 * 每张卡片优先锚定到发出 tool_calls 的助手消息（assistantMessageId），挂在该条目（message-group）
 * 的尾部工具块里、下一条消息之前；一次穿插多张工具调用时按数组顺序连续展示。
 * 锚点消息被持久化过滤重载后对不上时，回退按 turnUserId 挂到该轮用户消息之后；
 * 仍对不上（乐观消息无 id / 分页挤出 / 异常路径）时挂到最后一条用户消息之后，都没有则交由调用方挂到列表末尾。
 *
 * 返回 entryIndex → 卡片列表的映射（卡片渲染在该下标条目的 message-group 之后）；
 * unanchored 为连一条可挂载消息都找不到的兜底卡片。
 */
export function interleaveToolInvocations<
  TMessageEntry extends { kind: 'message'; item: { key: string; message: AgentMessage } },
  TInvocation extends ToolInvocationLike,
>(entries: readonly TMessageEntry[], items: readonly TInvocation[]) {
  /** 消息 id → 第一次出现的条目下标（同 id 消息只挂一次，避免重复）。 */
  const entryIndexByMessageId = new Map<string, number>();
  entries.forEach((entry, index) => {
    const id = entry.item.message.id;
    if (id && !entryIndexByMessageId.has(id)) {
      entryIndexByMessageId.set(id, index);
    }
  });
  const entryIndexByTurnUserId = new Map<string, number>();
  entries.forEach((entry, index) => {
    const message = entry.item.message;
    if (message.role === 'user' && message.id && !entryIndexByTurnUserId.has(message.id)) {
      entryIndexByTurnUserId.set(message.id, index);
    }
  });
  let lastUserEntryIndex = -1;
  entries.forEach((entry, index) => {
    if (entry.item.message.role === 'user') {
      lastUserEntryIndex = index;
    }
  });

  const invocationsByEntryIndex = new Map<number, TInvocation[]>();
  const unanchored: TInvocation[] = [];

  for (const item of items) {
    let targetIndex: number | null = null;
    if (item.assistantMessageId) {
      targetIndex = entryIndexByMessageId.get(item.assistantMessageId) ?? null;
    }
    if (targetIndex === null && item.turnUserId) {
      targetIndex = entryIndexByTurnUserId.get(item.turnUserId) ?? null;
    }
    if (targetIndex === null && lastUserEntryIndex >= 0) {
      targetIndex = lastUserEntryIndex;
    }

    if (targetIndex === null) {
      // 整个列表一条可挂载的消息都没有：交由调用方挂到列表末尾。
      unanchored.push(item);
      continue;
    }

    const bucket = invocationsByEntryIndex.get(targetIndex);
    if (bucket) {
      bucket.push(item);
    } else {
      invocationsByEntryIndex.set(targetIndex, [item]);
    }
  }

  return {
    invocationsByEntryIndex,
    unanchored,
  };
}

export type MessageListItem = {
  key: string;
  message: AgentMessage;
  index: number;
};

export type SubagentGroup = {
  kind: 'subagent';
  key: string;
  label: string;
  role: string;
  items: MessageListItem[];
  toolCount: number;
  previewText: string;
};

export type MessageListEntry =
  | ({ kind: 'message' } & MessageListItem)
  | SubagentGroup;

function getMessagePlainText(message: AgentMessage) {
  if (message.role !== 'tool') {
    return message.content;
  }

  const payload = parseToolMessage(message.content);
  return payload ? getToolDisplayText(payload) : message.content;
}

/** 折叠态下展示的一行进度预览：取组内最后一条有内容的消息。 */
export function getSubagentPreviewText(items: MessageListItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      continue;
    }

    const normalized = getMessagePlainText(item.message).replace(/\s+/g, ' ').trim();
    if (normalized) {
      return normalized.length > 160 ? `${normalized.slice(0, 160)}…` : normalized;
    }
  }

  return '子智能体已派发，等待输出…';
}

/**
 * 把同一个子智能体产生的消息合并成一个可折叠分组。
 * 按 subagent.id 聚合而不是按相邻位置，因为并行 fan-out 时多个子智能体的消息是交错到达的；
 * 分组的展示位置取该子智能体第一条消息的位置。
 */
export function groupMessagesBySubagent(messages: AgentMessage[]): MessageListEntry[] {
  const entries: MessageListEntry[] = [];
  const entryIndexBySubagentId = new Map<string, number>();

  messages.forEach((message, index) => {
    const item: MessageListItem = { key: getMessageKey(message, index), message, index };
    const subagent = message.workflow?.subagent;

    if (!subagent) {
      entries.push({ kind: 'message', ...item });
      return;
    }

    const existingIndex = entryIndexBySubagentId.get(subagent.id);
    const existing = existingIndex === undefined ? undefined : entries[existingIndex];

    if (existing && existing.kind === 'subagent') {
      existing.items.push(item);
      return;
    }

    entryIndexBySubagentId.set(subagent.id, entries.length);
    entries.push({
      kind: 'subagent',
      key: `subagent-${subagent.id}`,
      label: subagent.label,
      role: message.workflow?.actorRole ?? 'subagent',
      items: [item],
      toolCount: 0,
      previewText: '',
    });
  });

  for (const entry of entries) {
    if (entry.kind !== 'subagent') {
      continue;
    }

    entry.toolCount = entry.items.filter((item) => item.message.role === 'tool').length;
    entry.previewText = getSubagentPreviewText(entry.items);
  }

  return entries;
}
