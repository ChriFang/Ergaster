import { dialog, ipcMain, shell } from 'electron';
import type { CodeProjectListItem, CodeProjectOperationResult, ImportCodeProjectResult } from '../../shared/code-project';
import { buildCodeConversationScope } from '../../shared/code-project';
import { codeProjectsService } from './code-projects-service';
import { conversationService } from '../conversation/conversation-service';

export function registerCodeProjectHandlers() {
  ipcMain.handle('code-project:list', async (): Promise<CodeProjectListItem[]> => {
    return codeProjectsService.getProjectListItems();
  });

  ipcMain.handle('code-project:import', async (): Promise<ImportCodeProjectResult> => {
    const result = await dialog.showOpenDialog({
      title: '选择代码工程目录',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, cancelled: true };
    }

    return codeProjectsService.importProject(result.filePaths[0]);
  });

  ipcMain.handle('code-project:remove', async (_event, id: string): Promise<CodeProjectOperationResult> => {
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: '工程标识不能为空' };
    }

    const result = await codeProjectsService.removeProject(id);
    if (result.ok) {
      // 工程会话按 code:{projectId} 归组，移除工程时一并清理其会话
      await conversationService.deleteConversationsByAgent(buildCodeConversationScope(id.trim()));
    }
    return result;
  });

  ipcMain.handle('code-project:set-writable', async (_event, id: string, writable: boolean): Promise<CodeProjectOperationResult> => {
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: '工程标识不能为空' };
    }

    return codeProjectsService.setProjectWritable(id, writable === true);
  });

  ipcMain.handle('code-project:set-mcp-binding', async (_event, id: string, enabledServerNames: string[]): Promise<CodeProjectOperationResult> => {
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: '工程标识不能为空' };
    }

    return codeProjectsService.setProjectMcpBinding(id, Array.isArray(enabledServerNames) ? enabledServerNames : []);
  });

  ipcMain.handle('code-project:open-directory', async (_event, id: string): Promise<void> => {
    const project = typeof id === 'string' ? codeProjectsService.getProject(id) : null;
    if (project) {
      await shell.openPath(project.rootPath);
    }
  });
}
