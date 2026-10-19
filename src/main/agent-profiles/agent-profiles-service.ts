import fs from 'node:fs/promises';
import path from 'node:path';
import { getAppDataRoot } from '../core/app-paths';
import {
  DEFAULT_AGENT_ID,
  type AgentAvatarColor,
  type AgentProfileDetail,
  type AgentProfileListItem,
  type AgentProfileMetadata,
  type AgentProfileOperationResult,
  type AgentProfileRecord,
  type CreateAgentProfileRequest,
  type UpdateAgentProfileRequest,
} from '../../shared/agent-profile';
import type { McpAgentBinding } from '../../shared/mcp';
import { appendMainLog } from '../core/audit-log';
import { sanitizeMcpBinding } from '../mcp/mcp-config-utils';
import { loadMcpConfig } from '../mcp/mcp-config-service';
import { userSkillsService } from '../skills/user-skills-service';

const AGENT_CONTENT_FILE_NAME = 'AGENT.md';
const AGENT_META_FILE_NAME = 'agent.json';
const DEFAULT_MODEL = '';
const DEFAULT_AVATAR_COLOR: AgentAvatarColor = 'cyan';

function slugifyTitle(title: string) {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return normalized || 'agent';
}

function cloneBinding(binding?: McpAgentBinding): McpAgentBinding {
  return sanitizeMcpBinding(binding);
}

function normalizeAvatarColor(value: unknown): AgentAvatarColor {
  if (value === 'cyan' || value === 'blue' || value === 'violet' || value === 'emerald' || value === 'amber' || value === 'rose') {
    return value;
  }

  return DEFAULT_AVATAR_COLOR;
}

/**
 * 默认智能体的种子元数据。纯函数便于单测：
 * skills 取当前已安装快照、MCP 迁移自 mcp.json 的 defaultAgent 绑定，
 * 尽量贴近实体化之前"默认智能体 = 全局配置"的行为。
 */
export function buildDefaultAgentMetadata(skillNames: string[], enabledServerNames: string[], now: string): AgentProfileMetadata {
  return {
    id: DEFAULT_AGENT_ID,
    title: '默认智能体',
    description: '系统内置智能体，处理日常对话与通用任务。',
    model: '',
    avatarColor: DEFAULT_AVATAR_COLOR,
    skillNames: [...skillNames],
    uiDslEnabled: true,
    uiHtmlEnabled: false,
    createdAt: now,
    updatedAt: now,
    mcp: { enabledServerNames: [...enabledServerNames] },
  };
}

function normalizeSkillNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

export class AgentProfilesService {
  private readonly agentsDir = path.join(getAppDataRoot(), 'agents');
  private readonly loadedAgents = new Map<string, AgentProfileRecord>();

  getAgentsDirectory(): string {
    return this.agentsDir;
  }

  async scanAndLoadAgents(): Promise<void> {
    await this.ensureAgentsDirectory();

    const entries = await fs.readdir(this.agentsDir, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    const nextAgents = new Map<string, AgentProfileRecord>();

    for (const dir of directories) {
      const record = await this.loadAgentFromDirectory(path.join(this.agentsDir, dir.name));
      if (record) {
        nextAgents.set(record.metadata.id, record);
      }
    }

    this.loadedAgents.clear();
    for (const [id, record] of nextAgents) {
      this.loadedAgents.set(id, record);
    }

    await this.ensureDefaultAgentSeeded();

    await appendMainLog('INFO', `Loaded ${this.loadedAgents.size} agent profiles from ${this.agentsDir}`);
  }

  /** 首次启动时把内置默认智能体落成真实记录，纳入统一管理（不可删除）。 */
  private async ensureDefaultAgentSeeded() {
    if (this.loadedAgents.has(DEFAULT_AGENT_ID)) {
      return;
    }

    try {
      const skillNames = userSkillsService.getLoadedSkills().map((skill) => skill.metadata.name);
      const mcpConfig = await loadMcpConfig();
      const metadata = buildDefaultAgentMetadata(skillNames, mcpConfig.defaultAgent.enabledServerNames, new Date().toISOString());

      const directoryPath = path.join(this.agentsDir, DEFAULT_AGENT_ID);
      const contentPath = path.join(directoryPath, AGENT_CONTENT_FILE_NAME);
      const metadataPath = path.join(directoryPath, AGENT_META_FILE_NAME);

      await fs.mkdir(directoryPath, { recursive: true });
      await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      await fs.writeFile(contentPath, '', 'utf8');

      this.loadedAgents.set(DEFAULT_AGENT_ID, {
        metadata,
        content: '',
        directoryName: DEFAULT_AGENT_ID,
        directoryPath,
        contentPath,
      });
      await appendMainLog('INFO', 'Seeded default agent profile: default');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to seed default agent profile: ${message}`);
    }
  }

  async reloadAgents(): Promise<void> {
    this.loadedAgents.clear();
    await this.scanAndLoadAgents();
  }

  getAgentListItems(): AgentProfileListItem[] {
    return Array.from(this.loadedAgents.values())
      .map((record) => ({
        id: record.metadata.id,
        title: record.metadata.title,
        description: record.metadata.description,
        model: record.metadata.model,
        avatarColor: record.metadata.avatarColor,
        skillNames: [...record.metadata.skillNames],
        uiDslEnabled: record.metadata.uiDslEnabled,
        uiHtmlEnabled: record.metadata.uiHtmlEnabled,
        directoryName: record.directoryName,
        directoryPath: record.directoryPath,
        createdAt: record.metadata.createdAt,
        updatedAt: record.metadata.updatedAt,
        mcp: cloneBinding(record.metadata.mcp),
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getAgentDetail(id: string): AgentProfileDetail | null {
    const record = this.loadedAgents.get(id);
    if (!record) {
      return null;
    }

    return {
      id: record.metadata.id,
      title: record.metadata.title,
      description: record.metadata.description,
      model: record.metadata.model,
      avatarColor: record.metadata.avatarColor,
      skillNames: [...record.metadata.skillNames],
      uiDslEnabled: record.metadata.uiDslEnabled,
      uiHtmlEnabled: record.metadata.uiHtmlEnabled,
      content: record.content,
      directoryName: record.directoryName,
      directoryPath: record.directoryPath,
      createdAt: record.metadata.createdAt,
      updatedAt: record.metadata.updatedAt,
      mcp: cloneBinding(record.metadata.mcp),
    };
  }

  getAgentContent(id: string): string | null {
    return this.loadedAgents.get(id)?.content ?? null;
  }

  async createAgent(request: CreateAgentProfileRequest): Promise<AgentProfileOperationResult> {
    const title = request.title.trim();
    const description = request.description.trim();
    const model = request.model.trim() || DEFAULT_MODEL;
    const avatarColor = normalizeAvatarColor(request.avatarColor);
    const skillNames = normalizeSkillNames(request.skillNames);
    const content = request.content.trim();
    const mcp = cloneBinding(request.mcp);

    if (!title) {
      return { ok: false, error: '智能体标题不能为空' };
    }

    await this.ensureAgentsDirectory();

    const id = await this.generateAvailableId(title);
    const directoryPath = path.join(this.agentsDir, id);
    const contentPath = path.join(directoryPath, AGENT_CONTENT_FILE_NAME);
    const metadataPath = path.join(directoryPath, AGENT_META_FILE_NAME);
    const now = new Date().toISOString();

    const metadata: AgentProfileMetadata = {
      id,
      title,
      description,
      model,
      avatarColor,
      skillNames,
      uiDslEnabled: request.uiDslEnabled !== false,
      uiHtmlEnabled: request.uiHtmlEnabled === true,
      createdAt: now,
      updatedAt: now,
      mcp,
    };

    try {
      await fs.mkdir(directoryPath, { recursive: false });
      await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      await fs.writeFile(contentPath, `${content}\n`, 'utf8');

      const record: AgentProfileRecord = {
        metadata,
        content,
        directoryName: id,
        directoryPath,
        contentPath,
      };

      this.loadedAgents.set(id, record);
      await appendMainLog('INFO', `Created agent profile: ${id}`);

      return { ok: true, data: this.getAgentDetail(id) ?? undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建智能体失败';
      await appendMainLog('ERROR', `Failed to create agent profile: ${message}`);
      return { ok: false, error: message };
    }
  }

  async updateAgent(request: UpdateAgentProfileRequest): Promise<AgentProfileOperationResult> {
    const id = request.id.trim();
    const title = request.title.trim();
    const description = request.description.trim();
    const model = request.model.trim() || DEFAULT_MODEL;
    const avatarColor = normalizeAvatarColor(request.avatarColor);
    const skillNames = normalizeSkillNames(request.skillNames);
    const content = request.content.trim();
    const mcp = cloneBinding(request.mcp);

    if (!id) {
      return { ok: false, error: '智能体标识不能为空' };
    }

    if (!title) {
      return { ok: false, error: '智能体标题不能为空' };
    }

    const existing = this.loadedAgents.get(id);
    if (!existing) {
      return { ok: false, error: `未找到 ID 为 "${id}" 的智能体` };
    }

    const metadataPath = path.join(existing.directoryPath, AGENT_META_FILE_NAME);
    const updatedMetadata: AgentProfileMetadata = {
      ...existing.metadata,
      title,
      description,
      model,
      avatarColor,
      skillNames,
      uiDslEnabled: typeof request.uiDslEnabled === 'boolean' ? request.uiDslEnabled : existing.metadata.uiDslEnabled,
      uiHtmlEnabled: typeof request.uiHtmlEnabled === 'boolean' ? request.uiHtmlEnabled : existing.metadata.uiHtmlEnabled,
      updatedAt: new Date().toISOString(),
      mcp,
    };

    try {
      await fs.writeFile(metadataPath, `${JSON.stringify(updatedMetadata, null, 2)}\n`, 'utf8');
      await fs.writeFile(existing.contentPath, `${content}\n`, 'utf8');

      const record: AgentProfileRecord = {
        ...existing,
        metadata: updatedMetadata,
        content,
      };

      this.loadedAgents.set(id, record);
      await appendMainLog('INFO', `Updated agent profile: ${id}`);

      return { ok: true, data: this.getAgentDetail(id) ?? undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新智能体失败';
      await appendMainLog('ERROR', `Failed to update agent profile ${id}: ${message}`);
      return { ok: false, error: message };
    }
  }

  async deleteAgent(id: string): Promise<AgentProfileOperationResult> {
    const normalizedId = id.trim();
    if (normalizedId === DEFAULT_AGENT_ID) {
      return { ok: false, error: '默认智能体不允许删除。' };
    }

    const existing = this.loadedAgents.get(normalizedId);
    if (!existing) {
      return { ok: false, error: `未找到 ID 为 "${normalizedId}" 的智能体` };
    }

    try {
      await fs.rm(existing.directoryPath, { recursive: true, force: true });
      this.loadedAgents.delete(normalizedId);
      await appendMainLog('INFO', `Deleted agent profile: ${normalizedId}`);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除智能体失败';
      await appendMainLog('ERROR', `Failed to delete agent profile ${normalizedId}: ${message}`);
      return { ok: false, error: message };
    }
  }

  async removeMcpServerReference(serverName: string) {
    const normalizedName = serverName.trim();
    if (!normalizedName) {
      return;
    }

    for (const record of this.loadedAgents.values()) {
      if (!record.metadata.mcp.enabledServerNames.includes(normalizedName)) {
        continue;
      }

      const nextBinding = {
        enabledServerNames: record.metadata.mcp.enabledServerNames.filter((name) => name !== normalizedName),
      };

      await this.updateAgent({
        id: record.metadata.id,
        title: record.metadata.title,
        description: record.metadata.description,
        model: record.metadata.model,
        avatarColor: record.metadata.avatarColor,
        skillNames: record.metadata.skillNames,
        content: record.content,
        mcp: nextBinding,
      });
    }
  }

  async renameMcpServerReference(originalName: string, nextName: string) {
    const from = originalName.trim();
    const to = nextName.trim();

    if (!from || !to || from === to) {
      return;
    }

    for (const record of this.loadedAgents.values()) {
      if (!record.metadata.mcp.enabledServerNames.includes(from)) {
        continue;
      }

      const nextBinding = {
        enabledServerNames: record.metadata.mcp.enabledServerNames.map((name) => (name === from ? to : name)),
      };

      await this.updateAgent({
        id: record.metadata.id,
        title: record.metadata.title,
        description: record.metadata.description,
        model: record.metadata.model,
        avatarColor: record.metadata.avatarColor,
        skillNames: record.metadata.skillNames,
        content: record.content,
        mcp: nextBinding,
      });
    }
  }

  private async ensureAgentsDirectory() {
    await fs.mkdir(this.agentsDir, { recursive: true });
  }

  private async generateAvailableId(title: string) {
    const baseId = slugifyTitle(title);
    let candidate = baseId;
    let index = 2;

    while (this.loadedAgents.has(candidate) || (await this.pathExists(path.join(this.agentsDir, candidate)))) {
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

  private async loadAgentFromDirectory(directoryPath: string): Promise<AgentProfileRecord | null> {
    const metadataPath = path.join(directoryPath, AGENT_META_FILE_NAME);
    const contentPath = path.join(directoryPath, AGENT_CONTENT_FILE_NAME);

    try {
      const [metadataRaw, contentRaw] = await Promise.all([
        fs.readFile(metadataPath, 'utf8'),
        fs.readFile(contentPath, 'utf8'),
      ]);

      const metadata = this.parseMetadata(JSON.parse(metadataRaw) as Partial<AgentProfileMetadata>, directoryPath);
      const content = contentRaw.trim();
      return {
        metadata,
        content,
        directoryName: path.basename(directoryPath),
        directoryPath,
        contentPath,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to load agent profile from ${directoryPath}: ${message}`);
      return null;
    }
  }

  private parseMetadata(metadata: Partial<AgentProfileMetadata>, directoryPath: string): AgentProfileMetadata {
    const id = typeof metadata.id === 'string' && metadata.id.trim() ? metadata.id.trim() : path.basename(directoryPath);
    const title = typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title.trim() : id;
    const description = typeof metadata.description === 'string' ? metadata.description.trim() : '';
    const model = typeof metadata.model === 'string' && metadata.model.trim() ? metadata.model.trim() : DEFAULT_MODEL;
    const now = new Date().toISOString();

    return {
      id,
      title,
      description,
      model,
      avatarColor: normalizeAvatarColor(metadata.avatarColor),
      skillNames: normalizeSkillNames(metadata.skillNames),
      uiDslEnabled: metadata.uiDslEnabled !== false,
      uiHtmlEnabled: metadata.uiHtmlEnabled === true,
      createdAt: typeof metadata.createdAt === 'string' && metadata.createdAt.trim() ? metadata.createdAt : now,
      updatedAt: typeof metadata.updatedAt === 'string' && metadata.updatedAt.trim() ? metadata.updatedAt : now,
      mcp: cloneBinding(metadata.mcp),
    };
  }
}

export const agentProfilesService = new AgentProfilesService();
