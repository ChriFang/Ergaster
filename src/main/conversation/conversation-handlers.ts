import { ipcMain } from 'electron';
import { conversationService } from './conversation-service';
import type {
  ConversationListItem,
  ConversationMessagesPage,
  ConversationMessagesPageRequest,
  ConversationMeta,
  ConversationOperationResult,
  ConversationUnreadSummary,
} from '../../shared/conversation';
import type { AgentMessage } from '../../shared/agent';

export function registerConversationHandlers() {
  ipcMain.handle('conversation:list', async (): Promise<ConversationListItem[]> => {
    return conversationService.getConversationListItems();
  });

  ipcMain.handle('conversation:list-by-agent', async (_event, agentId: string | null): Promise<ConversationListItem[]> => {
    return conversationService.getConversationsByAgent(agentId);
  });

  ipcMain.handle('conversation:get', async (_event, id: string): Promise<ConversationMeta | null> => {
    return conversationService.getConversationMeta(id);
  });

  ipcMain.handle('conversation:create', async (_event, agentId: string | null, title?: string): Promise<ConversationMeta> => {
    return conversationService.createConversation(agentId, title);
  });

  ipcMain.handle('conversation:delete', async (_event, id: string): Promise<ConversationOperationResult> => {
    return conversationService.deleteConversation(id);
  });

  ipcMain.handle('conversation:rename', async (_event, conversationId: string, title: string): Promise<ConversationOperationResult> => {
    const meta = conversationService.getConversationMeta(conversationId);
    if (!meta) {
      return { ok: false, error: `未找到 ID 为 "${conversationId}" 的会话` };
    }

    await conversationService.updateConversationTitle(conversationId, title);
    return { ok: true };
  });

  ipcMain.handle('conversation:truncate', async (_event, conversationId: string, messageId: string): Promise<ConversationOperationResult> => {
    return conversationService.truncateToMessage(conversationId, messageId);
  });

  ipcMain.handle('conversation:get-messages', async (_event, conversationId: string): Promise<AgentMessage[]> => {
    const page = await conversationService.getPublicMessagesPage(conversationId, {
      cursor: null,
      limit: 100,
    });
    return page.messages;
  });

  ipcMain.handle(
    'conversation:get-messages-page',
    async (_event, conversationId: string, request: ConversationMessagesPageRequest): Promise<ConversationMessagesPage> => {
      return conversationService.getPublicMessagesPage(conversationId, request);
    },
  );

  ipcMain.handle('conversation:reset', async (_event, conversationId: string): Promise<ConversationOperationResult> => {
    return conversationService.resetConversation(conversationId);
  });

  ipcMain.handle('conversation:reload', async (): Promise<void> => {
    await conversationService.reloadConversations();
  });

  ipcMain.handle('conversation:clear-unread', async (_event, conversationId: string): Promise<number> => {
    return conversationService.clearUnread(conversationId);
  });

  ipcMain.handle('conversation:unread-summary', async (): Promise<ConversationUnreadSummary> => {
    return conversationService.getUnreadSummary();
  });

  ipcMain.handle('conversation:get-directory', async (): Promise<string> => {
    return conversationService.getConversationsDirectory();
  });
}
