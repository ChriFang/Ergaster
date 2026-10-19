import { ipcMain, shell } from 'electron';
import type {
  AgentProfileDetail,
  AgentProfileListItem,
  AgentProfileOperationResult,
  CreateAgentProfileRequest,
  UpdateAgentProfileRequest,
} from '../../shared/agent-profile';
import { agentProfilesService } from './agent-profiles-service';
import { conversationService } from '../conversation/conversation-service';

export function registerAgentProfileHandlers() {
  ipcMain.handle('agent-profile:list', async (): Promise<AgentProfileListItem[]> => {
    return agentProfilesService.getAgentListItems();
  });

  ipcMain.handle('agent-profile:get', async (_event, id: string): Promise<AgentProfileDetail | null> => {
    return agentProfilesService.getAgentDetail(id);
  });

  ipcMain.handle('agent-profile:create', async (_event, request: CreateAgentProfileRequest): Promise<AgentProfileOperationResult> => {
    return agentProfilesService.createAgent(request);
  });

  ipcMain.handle('agent-profile:update', async (_event, request: UpdateAgentProfileRequest): Promise<AgentProfileOperationResult> => {
    return agentProfilesService.updateAgent(request);
  });

  ipcMain.handle('agent-profile:delete', async (_event, id: string): Promise<AgentProfileOperationResult> => {
    const result = await agentProfilesService.deleteAgent(id);
    if (result.ok) {
      await conversationService.deleteConversationsByAgent(id);
    }
    return result;
  });

  ipcMain.handle('agent-profile:reload', async (): Promise<AgentProfileOperationResult> => {
    try {
      await agentProfilesService.reloadAgents();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '重新加载智能体失败' };
    }
  });

  ipcMain.handle('agent-profile:get-directory', async (): Promise<string> => {
    return agentProfilesService.getAgentsDirectory();
  });

  ipcMain.handle('agent-profile:open-directory', async (): Promise<void> => {
    await shell.openPath(agentProfilesService.getAgentsDirectory());
  });
}
