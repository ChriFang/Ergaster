import fs from 'node:fs/promises';
import path from 'node:path';
import { getAppDataRoot } from '../core/app-paths';
import {
  type CreateWorkflowDefinitionRequest,
  type UpdateWorkflowDefinitionRequest,
  type WorkflowDefinition,
  type WorkflowDefinitionListItem,
  type WorkflowDefinitionOperationResult,
  type WorkflowNode,
  type WorkflowNodePosition,
} from '../../shared/workflow-definition';
import { agentProfilesService } from '../agent-profiles/agent-profiles-service';
import { appendMainLog } from '../core/audit-log';

const WORKFLOW_FILE_NAME = 'workflow.json';

function slugifyTitle(title: string) {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return normalized || 'workflow';
}

function normalizePosition(value: unknown): WorkflowNodePosition {
  const fallback: WorkflowNodePosition = { x: 0, y: 0 };
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const raw = value as Record<string, unknown>;
  const x = typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : 0;
  const y = typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : 0;
  return { x, y };
}

function normalizeNode(value: unknown, fallbackId: string): WorkflowNode | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : fallbackId;
  const agentId = typeof raw.agentId === 'string' ? raw.agentId.trim() : '';
  if (!agentId) {
    // 没有引用智能体的节点视为无效，丢弃
    return null;
  }

  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : undefined;
  const inputTemplate = typeof raw.inputTemplate === 'string' && raw.inputTemplate.trim() ? raw.inputTemplate : undefined;

  return {
    id,
    agentId,
    label,
    inputTemplate,
    position: normalizePosition(raw.position),
  };
}

function normalizeNodes(value: unknown): WorkflowNode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: WorkflowNode[] = [];
  value.forEach((item, index) => {
    const node = normalizeNode(item, `node-${index + 1}`);
    if (!node) {
      return;
    }
    if (seen.has(node.id)) {
      node.id = `${node.id}-${index + 1}`;
    }
    seen.add(node.id);
    result.push(node);
  });

  return result;
}

type WorkflowRecord = {
  definition: WorkflowDefinition;
  directoryName: string;
  directoryPath: string;
  filePath: string;
};

export class WorkflowDefinitionsService {
  private readonly workflowsDir = path.join(getAppDataRoot(), 'workflows');
  private readonly loadedWorkflows = new Map<string, WorkflowRecord>();

  getWorkflowsDirectory(): string {
    return this.workflowsDir;
  }

  async scanAndLoadWorkflows(): Promise<void> {
    await this.ensureWorkflowsDirectory();

    const entries = await fs.readdir(this.workflowsDir, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    const nextWorkflows = new Map<string, WorkflowRecord>();

    for (const dir of directories) {
      const record = await this.loadWorkflowFromDirectory(path.join(this.workflowsDir, dir.name));
      if (record) {
        nextWorkflows.set(record.definition.id, record);
      }
    }

    this.loadedWorkflows.clear();
    for (const [id, record] of nextWorkflows) {
      this.loadedWorkflows.set(id, record);
    }

    await appendMainLog('INFO', `Loaded ${this.loadedWorkflows.size} workflow definitions from ${this.workflowsDir}`);
  }

  async reloadWorkflows(): Promise<void> {
    this.loadedWorkflows.clear();
    await this.scanAndLoadWorkflows();
  }

  getWorkflowListItems(): WorkflowDefinitionListItem[] {
    return Array.from(this.loadedWorkflows.values())
      .map((record) => {
        const definition = record.definition;
        const agentTitles = definition.nodes
          .map((node) => agentProfilesService.getAgentDetail(node.agentId)?.title ?? '（已失效）');
        return {
          id: definition.id,
          title: definition.title,
          description: definition.description,
          nodeCount: definition.nodes.length,
          agentTitles,
          createdAt: definition.createdAt,
          updatedAt: definition.updatedAt,
          directoryName: record.directoryName,
        };
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getWorkflowDefinition(id: string): WorkflowDefinition | null {
    const record = this.loadedWorkflows.get(id);
    if (!record) {
      return null;
    }

    return this.cloneDefinition(record.definition);
  }

  // 查询引用了某个智能体的工作流（供删除智能体时给出提示）
  getWorkflowsReferencingAgent(agentId: string): WorkflowDefinitionListItem[] {
    return this.getWorkflowListItems().filter((item) => {
      const definition = this.loadedWorkflows.get(item.id)?.definition;
      return definition?.nodes.some((node) => node.agentId === agentId) ?? false;
    });
  }

  async createWorkflow(request: CreateWorkflowDefinitionRequest): Promise<WorkflowDefinitionOperationResult> {
    const title = request.title.trim();
    const description = request.description.trim();
    const nodes = normalizeNodes(request.nodes);

    if (!title) {
      return { ok: false, error: '工作流标题不能为空' };
    }

    await this.ensureWorkflowsDirectory();

    const id = await this.generateAvailableId(title);
    const directoryPath = path.join(this.workflowsDir, id);
    const filePath = path.join(directoryPath, WORKFLOW_FILE_NAME);
    const now = new Date().toISOString();

    const definition: WorkflowDefinition = {
      id,
      title,
      description,
      nodes,
      createdAt: now,
      updatedAt: now,
      directoryName: id,
      directoryPath,
    };

    try {
      await fs.mkdir(directoryPath, { recursive: false });
      await fs.writeFile(filePath, `${JSON.stringify(definition, null, 2)}\n`, 'utf8');

      const record: WorkflowRecord = {
        definition,
        directoryName: id,
        directoryPath,
        filePath,
      };

      this.loadedWorkflows.set(id, record);
      await appendMainLog('INFO', `Created workflow definition: ${id}`);

      return { ok: true, data: this.cloneDefinition(definition) };
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建工作流失败';
      await appendMainLog('ERROR', `Failed to create workflow definition: ${message}`);
      return { ok: false, error: message };
    }
  }

  async updateWorkflow(request: UpdateWorkflowDefinitionRequest): Promise<WorkflowDefinitionOperationResult> {
    const id = request.id.trim();
    const title = request.title.trim();
    const description = request.description.trim();
    const nodes = normalizeNodes(request.nodes);

    if (!id) {
      return { ok: false, error: '工作流标识不能为空' };
    }

    if (!title) {
      return { ok: false, error: '工作流标题不能为空' };
    }

    const existing = this.loadedWorkflows.get(id);
    if (!existing) {
      return { ok: false, error: `未找到 ID 为 "${id}" 的工作流` };
    }

    const updatedDefinition: WorkflowDefinition = {
      ...existing.definition,
      title,
      description,
      nodes,
      updatedAt: new Date().toISOString(),
    };

    try {
      await fs.writeFile(existing.filePath, `${JSON.stringify(updatedDefinition, null, 2)}\n`, 'utf8');

      const record: WorkflowRecord = {
        ...existing,
        definition: updatedDefinition,
      };

      this.loadedWorkflows.set(id, record);
      await appendMainLog('INFO', `Updated workflow definition: ${id}`);

      return { ok: true, data: this.cloneDefinition(updatedDefinition) };
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新工作流失败';
      await appendMainLog('ERROR', `Failed to update workflow definition ${id}: ${message}`);
      return { ok: false, error: message };
    }
  }

  async deleteWorkflow(id: string): Promise<WorkflowDefinitionOperationResult> {
    const normalizedId = id.trim();
    const existing = this.loadedWorkflows.get(normalizedId);
    if (!existing) {
      return { ok: false, error: `未找到 ID 为 "${normalizedId}" 的工作流` };
    }

    try {
      await fs.rm(existing.directoryPath, { recursive: true, force: true });
      this.loadedWorkflows.delete(normalizedId);
      await appendMainLog('INFO', `Deleted workflow definition: ${normalizedId}`);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除工作流失败';
      await appendMainLog('ERROR', `Failed to delete workflow definition ${normalizedId}: ${message}`);
      return { ok: false, error: message };
    }
  }

  private cloneDefinition(definition: WorkflowDefinition): WorkflowDefinition {
    return {
      ...definition,
      nodes: definition.nodes.map((node) => ({
        ...node,
        position: { ...node.position },
      })),
    };
  }

  private async ensureWorkflowsDirectory() {
    await fs.mkdir(this.workflowsDir, { recursive: true });
  }

  private async generateAvailableId(title: string) {
    const baseId = slugifyTitle(title);
    let candidate = baseId;
    let index = 2;

    while (this.loadedWorkflows.has(candidate) || (await this.pathExists(path.join(this.workflowsDir, candidate)))) {
      candidate = `${baseId}-${index}`;
      index += 1;
    }

    return candidate;
  }

  private async pathExists(targetPath: string) {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async loadWorkflowFromDirectory(directoryPath: string): Promise<WorkflowRecord | null> {
    const filePath = path.join(directoryPath, WORKFLOW_FILE_NAME);

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<WorkflowDefinition>;
      const definition = this.parseDefinition(parsed, directoryPath);
      return {
        definition,
        directoryName: path.basename(directoryPath),
        directoryPath,
        filePath,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to load workflow definition from ${directoryPath}: ${message}`);
      return null;
    }
  }

  private parseDefinition(parsed: Partial<WorkflowDefinition>, directoryPath: string): WorkflowDefinition {
    const id = typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : path.basename(directoryPath);
    const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : id;
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
    const now = new Date().toISOString();

    return {
      id,
      title,
      description,
      nodes: normalizeNodes(parsed.nodes),
      createdAt: typeof parsed.createdAt === 'string' && parsed.createdAt.trim() ? parsed.createdAt : now,
      updatedAt: typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim() ? parsed.updatedAt : now,
      directoryName: path.basename(directoryPath),
      directoryPath,
    };
  }
}

export const workflowDefinitionsService = new WorkflowDefinitionsService();
