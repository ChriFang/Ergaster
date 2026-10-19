import { ipcMain, shell } from 'electron';
import type { McpAgentBinding, McpConfig, McpOperationResult, McpServerListItem, SaveMcpServerRequest } from '../../shared/mcp';
import { agentProfilesService } from '../agent-profiles/agent-profiles-service';
import {
  deleteMcpServer,
  ensureMcpConfigFile,
  getMcpConfigPath,
  listMcpServers,
  loadMcpConfig,
  saveDefaultAgentMcpBinding,
  saveMcpServer,
} from './mcp-config-service';
import { mcpService } from './mcp-service';
import { appendMainLog } from '../core/audit-log';

export function registerMcpHandlers() {
  ipcMain.handle('mcp:get-config', async (): Promise<McpConfig> => {
    return loadMcpConfig();
  });

  ipcMain.handle('mcp:list-servers', async (): Promise<McpServerListItem[]> => {
    return listMcpServers();
  });

  ipcMain.handle('mcp:save-server', async (_event, request: SaveMcpServerRequest): Promise<McpOperationResult> => {
    try {
      const originalName = request.originalName?.trim() || null;
      const nextName = request.name.trim();
      const result = await saveMcpServer(request);

      if (originalName && originalName !== nextName) {
        await agentProfilesService.renameMcpServerReference(originalName, nextName);
        await mcpService.invalidateServer(originalName);
      }

      await mcpService.invalidateServer(nextName);
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '保存 MCP 服务失败' };
    }
  });

  ipcMain.handle('mcp:delete-server', async (_event, name: string): Promise<McpOperationResult> => {
    try {
      await deleteMcpServer(name);
      await agentProfilesService.removeMcpServerReference(name);
      await mcpService.invalidateServer(name);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '删除 MCP 服务失败' };
    }
  });

  ipcMain.handle('mcp:save-default-binding', async (_event, binding: McpAgentBinding): Promise<McpOperationResult> => {
    try {
      const result = await saveDefaultAgentMcpBinding(binding);
      return { ok: true, data: result.defaultAgent };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '保存默认模式 MCP 绑定失败' };
    }
  });

  ipcMain.handle('mcp:get-config-path', async (): Promise<string> => {
    return getMcpConfigPath();
  });

  ipcMain.handle('mcp:open-config-file', async (): Promise<void> => {
    const configPath = await ensureMcpConfigFile();
    const error = await shell.openPath(configPath);
    if (error) {
      await appendMainLog('ERROR', `[mcp] Failed to open config file ${configPath}: ${error}`);
      throw new Error(error);
    }
  });
}
