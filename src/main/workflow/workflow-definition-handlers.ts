import { ipcMain, shell } from 'electron';
import type {
  CreateWorkflowDefinitionRequest,
  UpdateWorkflowDefinitionRequest,
  WorkflowDefinition,
  WorkflowDefinitionListItem,
  WorkflowDefinitionOperationResult,
} from '../../shared/workflow-definition';
import { workflowDefinitionsService } from './workflow-definitions-service';

export function registerWorkflowDefinitionHandlers() {
  ipcMain.handle('workflow-definition:list', async (): Promise<WorkflowDefinitionListItem[]> => {
    return workflowDefinitionsService.getWorkflowListItems();
  });

  ipcMain.handle('workflow-definition:get', async (_event, id: string): Promise<WorkflowDefinition | null> => {
    return workflowDefinitionsService.getWorkflowDefinition(id);
  });

  ipcMain.handle('workflow-definition:create', async (_event, request: CreateWorkflowDefinitionRequest): Promise<WorkflowDefinitionOperationResult> => {
    return workflowDefinitionsService.createWorkflow(request);
  });

  ipcMain.handle('workflow-definition:update', async (_event, request: UpdateWorkflowDefinitionRequest): Promise<WorkflowDefinitionOperationResult> => {
    return workflowDefinitionsService.updateWorkflow(request);
  });

  ipcMain.handle('workflow-definition:delete', async (_event, id: string): Promise<WorkflowDefinitionOperationResult> => {
    return workflowDefinitionsService.deleteWorkflow(id);
  });

  ipcMain.handle('workflow-definition:reload', async (): Promise<WorkflowDefinitionOperationResult> => {
    try {
      await workflowDefinitionsService.reloadWorkflows();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '重新加载工作流失败' };
    }
  });

  ipcMain.handle('workflow-definition:get-directory', async (): Promise<string> => {
    return workflowDefinitionsService.getWorkflowsDirectory();
  });

  ipcMain.handle('workflow-definition:open-directory', async (): Promise<void> => {
    await shell.openPath(workflowDefinitionsService.getWorkflowsDirectory());
  });

  // 供删除智能体时查询引用关系
  ipcMain.handle('workflow-definition:list-by-agent', async (_event, agentId: string): Promise<WorkflowDefinitionListItem[]> => {
    return workflowDefinitionsService.getWorkflowsReferencingAgent(agentId);
  });
}
