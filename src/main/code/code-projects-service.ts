import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getAppDataRoot } from '../core/app-paths';
import { appendMainLog } from '../core/audit-log';
import { countProjectFiles } from './code-tools';
import { loadMcpConfig } from '../mcp/mcp-config-service';
import type { CodeProjectListItem, CodeProjectMetadata, CodeProjectOperationResult } from '../../shared/code-project';

const PROJECTS_FILE_NAME = 'projects.json';
const STORAGE_VERSION = 1 as const;
/** 超过该文件数只给提示，不阻断导入：检索会变慢但仍然可用。 */
const LARGE_PROJECT_FILE_THRESHOLD = 20_000;

type ProjectsFilePayload = {
  version: typeof STORAGE_VERSION;
  projects: CodeProjectMetadata[];
};

function slugifyName(name: string) {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return normalized || 'project';
}

export class CodeProjectsService {
  private readonly projectsDir = path.join(getAppDataRoot(), 'code-projects');
  private readonly projectsFilePath = path.join(getAppDataRoot(), 'code-projects', PROJECTS_FILE_NAME);
  private readonly loadedProjects = new Map<string, CodeProjectMetadata>();

  getProjectsDirectory(): string {
    return this.projectsDir;
  }

  async scanAndLoadProjects(): Promise<void> {
    await fs.mkdir(this.projectsDir, { recursive: true });

    try {
      const raw = await fs.readFile(this.projectsFilePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ProjectsFilePayload>;
      const projects = Array.isArray(parsed.projects) ? parsed.projects : [];

      this.loadedProjects.clear();
      for (const project of projects) {
        const normalized = this.normalizeProject(project);
        if (normalized) {
          this.loadedProjects.set(normalized.id, normalized);
        }
      }

      await appendMainLog('INFO', `Loaded ${this.loadedProjects.size} code projects from ${this.projectsFilePath}`);
    } catch {
      this.loadedProjects.clear();
    }
  }

  getProjectListItems(): CodeProjectListItem[] {
    return Array.from(this.loadedProjects.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getProject(id: string): CodeProjectListItem | null {
    return this.loadedProjects.get(id.trim()) ?? null;
  }

  /** 工具执行时用来拿沙箱根目录。工程不存在时返回 null，由调用方转成模型可读的错误。 */
  getProjectRoot(id: string): string | null {
    return this.loadedProjects.get(id.trim())?.rootPath ?? null;
  }

  /** 写入类工具是否可用。工程不存在时按不可写处理。 */
  isProjectWritable(id: string): boolean {
    return this.loadedProjects.get(id.trim())?.writable ?? false;
  }

  async setProjectWritable(id: string, writable: boolean): Promise<CodeProjectOperationResult> {
    const normalizedId = id.trim();
    const existing = this.loadedProjects.get(normalizedId);
    if (!existing) {
      return { ok: false, error: `未找到 ID 为 "${normalizedId}" 的代码工程` };
    }

    const previous = existing;
    const next: CodeProjectMetadata = { ...existing, writable, updatedAt: new Date().toISOString() };
    this.loadedProjects.set(normalizedId, next);

    try {
      await this.persist();
    } catch (error) {
      this.loadedProjects.set(normalizedId, previous);
      const message = error instanceof Error ? error.message : '更新工程写权限失败';
      return { ok: false, error: message };
    }

    await appendMainLog('INFO', `Code project writable changed: ${normalizedId} -> ${writable}`);
    return { ok: true, data: next };
  }

  /** 更新工程的 MCP 服务绑定。服务名做存在性校验，防止配置漂移后残留死引用。 */
  async setProjectMcpBinding(id: string, enabledServerNames: string[]): Promise<CodeProjectOperationResult> {
    const normalizedId = id.trim();
    const existing = this.loadedProjects.get(normalizedId);
    if (!existing) {
      return { ok: false, error: `未找到 ID 为 "${normalizedId}" 的代码工程` };
    }

    if (!Array.isArray(enabledServerNames)) {
      return { ok: false, error: 'MCP 服务绑定格式不正确。' };
    }

    const config = await loadMcpConfig();
    const knownServers = new Set(Object.keys(config.mcpServers));
    const unknown = enabledServerNames.filter((name) => typeof name === 'string' && name.trim() && !knownServers.has(name.trim()));
    if (unknown.length > 0) {
      return { ok: false, error: `未找到 MCP 服务：${unknown.join('、')}` };
    }

    const normalizedNames = Array.from(new Set(enabledServerNames.map((name) => name.trim()).filter(Boolean)));
    const previous = existing;
    const next: CodeProjectMetadata = {
      ...existing,
      mcp: { enabledServerNames: normalizedNames },
      updatedAt: new Date().toISOString(),
    };
    this.loadedProjects.set(normalizedId, next);

    try {
      await this.persist();
    } catch (error) {
      this.loadedProjects.set(normalizedId, previous);
      const message = error instanceof Error ? error.message : '更新工程 MCP 绑定失败';
      return { ok: false, error: message };
    }

    await appendMainLog('INFO', `Code project MCP binding changed: ${normalizedId} -> [${normalizedNames.join(', ')}]`);
    return { ok: true, data: next };
  }

  async importProject(rootPath: string): Promise<CodeProjectOperationResult> {
    const resolvedPath = path.resolve(rootPath.trim());

    const validationError = await this.validateProjectRoot(resolvedPath);
    if (validationError) {
      return { ok: false, error: validationError };
    }

    const duplicate = Array.from(this.loadedProjects.values()).find((project) => project.rootPath === resolvedPath);
    if (duplicate) {
      return { ok: false, error: `该工程已导入：${duplicate.name}` };
    }

    const now = new Date().toISOString();
    const project: CodeProjectMetadata = {
      id: this.generateAvailableId(path.basename(resolvedPath)),
      name: path.basename(resolvedPath) || resolvedPath,
      rootPath: resolvedPath,
      // 新导入的工程默认只读，写权限由用户显式开启；MCP 也不默认接入
      writable: false,
      mcp: { enabledServerNames: [] },
      createdAt: now,
      updatedAt: now,
    };

    this.loadedProjects.set(project.id, project);

    try {
      await this.persist();
    } catch (error) {
      this.loadedProjects.delete(project.id);
      const message = error instanceof Error ? error.message : '导入代码工程失败';
      await appendMainLog('ERROR', `Failed to import code project ${resolvedPath}: ${message}`);
      return { ok: false, error: message };
    }

    await appendMainLog('INFO', `Imported code project: ${project.id} -> ${resolvedPath}`);

    const warning = await this.buildSizeWarning(resolvedPath);
    return { ok: true, data: project, ...(warning ? { warning } : {}) };
  }

  async removeProject(id: string): Promise<CodeProjectOperationResult> {
    const normalizedId = id.trim();
    const existing = this.loadedProjects.get(normalizedId);
    if (!existing) {
      return { ok: false, error: `未找到 ID 为 "${normalizedId}" 的代码工程` };
    }

    this.loadedProjects.delete(normalizedId);

    try {
      await this.persist();
    } catch (error) {
      this.loadedProjects.set(normalizedId, existing);
      const message = error instanceof Error ? error.message : '移除代码工程失败';
      return { ok: false, error: message };
    }

    // 只解除应用内的引用，不触碰用户磁盘上的工程文件
    await appendMainLog('INFO', `Removed code project reference: ${normalizedId}`);
    return { ok: true };
  }

  /**
   * 导入前的硬性拦截：必须是已存在的目录，且不能是文件系统根、家目录或家目录的祖先，
   * 否则等于把整块磁盘交给模型检索。
   */
  private async validateProjectRoot(resolvedPath: string): Promise<string | null> {
    if (!path.isAbsolute(resolvedPath)) {
      return '工程路径必须是绝对路径。';
    }

    const homeDir = path.resolve(os.homedir());
    const filesystemRoot = path.parse(resolvedPath).root;

    if (resolvedPath === filesystemRoot) {
      return '不允许把文件系统根目录作为代码工程。';
    }

    if (resolvedPath === homeDir) {
      return '不允许把用户主目录作为代码工程，请选择具体的工程目录。';
    }

    if (homeDir === resolvedPath || homeDir.startsWith(`${resolvedPath}${path.sep}`)) {
      return '所选目录包含用户主目录，范围过大，请选择具体的工程目录。';
    }

    if (resolvedPath === path.resolve(getAppDataRoot()) || resolvedPath.startsWith(`${path.resolve(getAppDataRoot())}${path.sep}`)) {
      return '不允许把应用数据目录作为代码工程。';
    }

    try {
      const stat = await fs.stat(resolvedPath);
      if (!stat.isDirectory()) {
        return '所选路径不是目录。';
      }
    } catch {
      return '所选目录不存在或无法访问。';
    }

    return null;
  }

  private async buildSizeWarning(resolvedPath: string): Promise<string | null> {
    try {
      const { fileCount, truncated } = await countProjectFiles(
        resolvedPath,
        LARGE_PROJECT_FILE_THRESHOLD + 1,
        AbortSignal.timeout(10_000),
      );

      if (truncated || fileCount > LARGE_PROJECT_FILE_THRESHOLD) {
        return `该工程文件数超过 ${LARGE_PROJECT_FILE_THRESHOLD}，代码检索可能较慢，建议检索时缩小目录范围。`;
      }
    } catch {
      // 统计失败不影响导入结果
    }

    return null;
  }

  private generateAvailableId(name: string) {
    const baseId = slugifyName(name);
    let candidate = baseId;
    let index = 2;

    while (this.loadedProjects.has(candidate)) {
      candidate = `${baseId}-${index}`;
      index += 1;
    }

    return candidate;
  }

  private normalizeProject(raw: Partial<CodeProjectMetadata>): CodeProjectMetadata | null {
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const rootPath = typeof raw.rootPath === 'string' ? raw.rootPath.trim() : '';
    if (!id || !rootPath) {
      return null;
    }

    const now = new Date().toISOString();
    const mcpBinding = Array.isArray(raw.mcp?.enabledServerNames)
      ? { enabledServerNames: Array.from(new Set(raw.mcp.enabledServerNames.filter((name): name is string => typeof name === 'string' && name.trim().length > 0).map((name) => name.trim()))) }
      : { enabledServerNames: [] };

    return {
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : path.basename(rootPath),
      rootPath: path.resolve(rootPath),
      writable: raw.writable === true,
      mcp: mcpBinding,
      createdAt: typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : now,
    };
  }

  private async persist() {
    await fs.mkdir(this.projectsDir, { recursive: true });
    const payload: ProjectsFilePayload = {
      version: STORAGE_VERSION,
      projects: this.getProjectListItems(),
    };
    await fs.writeFile(this.projectsFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
}

export const codeProjectsService = new CodeProjectsService();
