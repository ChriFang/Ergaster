import type { AgentMessage } from './agent';

export type ConversationMeta = {
  id: string;
  agentId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  tokenEstimate: number;
  summary: string | null;
  summarizedAt: string | null;
  summarizedMessageCount: number;
  storageVersion: 2;
  segmentCount: number;
  /** 未读消息数。定时任务把结果追加进会话时 +1，用户打开该会话时清零。 */
  unreadCount: number;
};

export type ConversationListItem = {
  id: string;
  agentId: string | null;
  title: string;
  messageCount: number;
  tokenEstimate: number;
  hasSummary: boolean;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
};

export type ConversationOperationResult = {
  ok: boolean;
  data?: ConversationMeta;
  error?: string;
};

/** 主进程主动推送的会话变更事件（后台生成的标题落定、定时任务结果落地等）。 */
export type ConversationChangedEvent = {
  conversationId: string;
  title: string;
  unreadCount?: number;
  messageCount?: number;
};

/** 按 scope（智能体 id / code:{projectId}）聚合的未读数，用于侧边栏智能体徽标。 */
export type ConversationUnreadSummary = Record<string, number>;

export type ConversationMessageCursor = {
  segmentIndex: number;
  messageIndex: number;
};

export type ConversationMessagesPageRequest = {
  cursor: ConversationMessageCursor | null;
  limit: number;
};

export type ConversationMessagesPage = {
  messages: AgentMessage[];
  total: number;
  hasMoreBefore: boolean;
  nextCursor: ConversationMessageCursor | null;
};
