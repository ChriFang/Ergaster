import { ipcMain } from 'electron';
import { scheduledTaskService } from './scheduled-task-service';
import type { ScheduledTask } from '../../shared/scheduled-task';

export function registerScheduledTaskHandlers() {
  ipcMain.handle('scheduled-task:list', async (_event, conversationId?: string): Promise<ScheduledTask[]> => {
    const normalized = conversationId?.trim();
    return normalized ? scheduledTaskService.listByConversation(normalized) : scheduledTaskService.listAll();
  });
}
