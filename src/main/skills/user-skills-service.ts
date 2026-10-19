import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { UserSkillDefinition, SkillMetadata, SkillExecuteConfig, InstalledSkillFile } from '../../shared/user-skills';
import type { SkillListItem, SkillOperationResult, SkillFullContent, SkillsChangedEvent } from '../../shared/skill-contracts';
import type { ToolRisk } from '../../shared/tools';
import { appendMainLog } from '../core/audit-log';
import { getAppDataRoot } from '../core/app-paths';

const SKILL_FILE_NAME = 'SKILL.md';

export class UserSkillsService {
  private skillsDir: string;
  private loadedSkills: Map<string, UserSkillDefinition> = new Map();
  private skillFileStats: Map<string, { createdAt: string; updatedAt: string }> = new Map();
  private skillsChangedListeners = new Set<(event: SkillsChangedEvent) => void>();

  constructor() {
    this.skillsDir = path.join(getAppDataRoot(), 'skills');
  }

  /** 订阅 Skills 集合变更（新增/更新/删除/安装）。返回取消订阅函数。 */
  onSkillsChanged(listener: (event: SkillsChangedEvent) => void): () => void {
    this.skillsChangedListeners.add(listener);
    return () => {
      this.skillsChangedListeners.delete(listener);
    };
  }

  private emitSkillsChanged(event: SkillsChangedEvent): void {
    for (const listener of this.skillsChangedListeners) {
      try {
        listener(event);
      } catch {
        // 单个监听器异常不影响其他监听器与主流程
      }
    }
  }

  /** 已加载 Skill 的名称列表（供安装时防重名与 typosquat 比对）。 */
  listNames(): string[] {
    return Array.from(this.loadedSkills.keys());
  }

  getSkillsDirectory(): string {
    return this.skillsDir;
  }

  async scanAndLoadSkills(): Promise<void> {
    try {
      await fs.mkdir(this.skillsDir, { recursive: true });

      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
      const directories = entries.filter((entry) => entry.isDirectory());

      for (const dir of directories) {
        const dirPath = path.join(this.skillsDir, dir.name);
        await this.loadSkillFromDirectory(dirPath);
      }

      await appendMainLog('INFO', `Loaded ${this.loadedSkills.size} user skills from ${this.skillsDir}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to scan skills directory: ${message}`);
    }
  }

  async loadSkillFromDirectory(dirPath: string): Promise<UserSkillDefinition | null> {
    const skillFilePath = path.join(dirPath, SKILL_FILE_NAME);

    try {
      const stat = await fs.stat(skillFilePath);
      if (!stat.isFile()) {
        return null;
      }

      const fileContent = await fs.readFile(skillFilePath, 'utf-8');
      const { metadata, body } = this.parseSkillMarkdown(fileContent);

      if (!metadata.name) {
        await appendMainLog('ERROR', `Skill missing name: ${skillFilePath}`);
        return null;
      }

      if (!metadata.description) {
        await appendMainLog('ERROR', `Skill missing description: ${skillFilePath}`);
        return null;
      }

      if (!/^[a-z][a-z0-9-]{0,63}$/.test(metadata.name)) {
        await appendMainLog('ERROR', `Invalid skill name format: ${metadata.name} in ${skillFilePath}`);
        return null;
      }

      if (this.loadedSkills.has(metadata.name)) {
        await appendMainLog('ERROR', `Skill name conflict: ${metadata.name} already loaded, skipping ${skillFilePath}`);
        return null;
      }

      const skill: UserSkillDefinition = {
        metadata,
        content: body,
        directoryName: path.basename(dirPath),
        directoryPath: dirPath,
        filePath: skillFilePath,
        risk: this.parseRiskLevel(metadata),
      };

      this.skillFileStats.set(metadata.name, {
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      });

      this.loadedSkills.set(metadata.name, skill);
      await appendMainLog('INFO', `Loaded user skill: ${metadata.name} from ${skillFilePath}`);

      return skill;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to load skill from ${dirPath}: ${message}`);
      return null;
    }
  }

  parseSkillMarkdown(content: string): { metadata: SkillMetadata; body: string } {
    const frontmatterRegex = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      throw new Error('Invalid SKILL.md format: missing YAML frontmatter');
    }

    const yamlContent = match[1];
    const body = match[2];

    try {
      const metadata = parseYaml(yamlContent) as SkillMetadata;
      return { metadata, body };
    } catch (error) {
      throw new Error(`Failed to parse YAML frontmatter: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  parseRiskLevel(metadata: SkillMetadata): ToolRisk {
    const risk = metadata.metadata?.risk;
    if (risk === 'low' || risk === 'medium' || risk === 'high') {
      return risk;
    }
    return 'medium';
  }

  parseExecuteConfig(metadata: SkillMetadata): SkillExecuteConfig | undefined {
    return metadata.metadata?.execute;
  }

  getLoadedSkills(): UserSkillDefinition[] {
    return Array.from(this.loadedSkills.values());
  }

  getSkill(name: string): UserSkillDefinition | undefined {
    return this.loadedSkills.get(name);
  }

  getSkillByDirectoryName(dirName: string): UserSkillDefinition | undefined {
    return Array.from(this.loadedSkills.values()).find((s) => s.directoryName === dirName);
  }

  getSkillListItems(): SkillListItem[] {
    return Array.from(this.loadedSkills.values()).map((skill) => {
      const stats = this.skillFileStats.get(skill.metadata.name);
      return {
        name: skill.metadata.name,
        description: skill.metadata.description,
        directoryName: skill.directoryName,
        directoryPath: skill.directoryPath,
        createdAt: stats?.createdAt ?? new Date().toISOString(),
        updatedAt: stats?.updatedAt ?? new Date().toISOString(),
      };
    });
  }

  getSkillFullContent(name: string): SkillFullContent | null {
    const skill = this.loadedSkills.get(name);
    if (!skill) {
      return null;
    }

    return {
      name: skill.metadata.name,
      description: skill.metadata.description,
      content: skill.content,
      directoryName: skill.directoryName,
    };
  }

  buildSkillMarkdown(input: { name: string; description: string; content: string }): string {
    const metadata: SkillMetadata = {
      name: input.name,
      description: input.description,
    };
    const frontmatter = stringifyYaml(metadata as Record<string, unknown>);
    return `---\n${frontmatter}---\n\n${input.content.trim()}\n`;
  }

  buildFullMarkdown(skill: UserSkillDefinition): string {
    return this.buildSkillMarkdown({
      name: skill.metadata.name,
      description: skill.metadata.description,
      content: skill.content,
    });
  }

  async createSkill(request: { name: string; description: string; content: string }): Promise<SkillOperationResult> {
    try {
      const name = request.name.trim();
      const description = request.description.trim();
      const content = request.content.trim();

      if (!name) {
        return { ok: false, error: 'Skill 必须包含名称' };
      }

      if (!description) {
        return { ok: false, error: 'Skill 必须包含描述' };
      }

      if (!content) {
        return { ok: false, error: 'Skill 内容不能为空' };
      }

      if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
        return { ok: false, error: '名称格式错误：必须以小写字母开头，仅允许小写字母、数字和连字符，最长64字符' };
      }

      if (this.loadedSkills.has(name)) {
        return { ok: false, error: `Skill 名称 "${name}" 已存在` };
      }

      const markdownContent = this.buildSkillMarkdown({
        name,
        description,
        content,
      });
      const { metadata, body } = this.parseSkillMarkdown(markdownContent);
      const dirPath = path.join(this.skillsDir, name);
      await fs.mkdir(dirPath, { recursive: true });

      const skillFilePath = path.join(dirPath, SKILL_FILE_NAME);
      await fs.writeFile(skillFilePath, markdownContent, 'utf-8');

      const stat = await fs.stat(skillFilePath);
      this.skillFileStats.set(metadata.name, {
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      });

      const skill: UserSkillDefinition = {
        metadata,
        content: body,
        directoryName: metadata.name,
        directoryPath: dirPath,
        filePath: skillFilePath,
        risk: this.parseRiskLevel(metadata),
      };

      this.loadedSkills.set(metadata.name, skill);

      await appendMainLog('INFO', `Created user skill: ${metadata.name} at ${skillFilePath}`);

      this.emitSkillsChanged({ reason: 'created', name: metadata.name });

      return { ok: true, data: skill };
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建失败';
      await appendMainLog('ERROR', `Failed to create skill: ${message}`);
      return { ok: false, error: message };
    }
  }

  async updateSkill(directoryName: string, request: { name: string; description: string; content: string }): Promise<SkillOperationResult> {
    try {
      const name = request.name.trim();
      const description = request.description.trim();
      const content = request.content.trim();

      if (!name) {
        return { ok: false, error: 'Skill 必须包含名称' };
      }

      if (!description) {
        return { ok: false, error: 'Skill 必须包含描述' };
      }

      if (!content) {
        return { ok: false, error: 'Skill 内容不能为空' };
      }

      if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
        return { ok: false, error: '名称格式错误：必须以小写字母开头，仅允许小写字母、数字和连字符，最长64字符' };
      }

      const existingSkill = this.getSkillByDirectoryName(directoryName);
      if (!existingSkill) {
        return { ok: false, error: `目录 "${directoryName}" 对应的 Skill 不存在` };
      }

      const oldName = existingSkill.metadata.name;
      const newName = name;

      if (oldName !== newName && this.loadedSkills.has(newName)) {
        return { ok: false, error: `Skill 名称 "${newName}" 已存在` };
      }

      const markdownContent = this.buildSkillMarkdown({
        name,
        description,
        content,
      });
      const { metadata, body } = this.parseSkillMarkdown(markdownContent);

      let dirPath = existingSkill.directoryPath;
      let skillFilePath = existingSkill.filePath;

      if (oldName !== newName) {
        const newDirPath = path.join(this.skillsDir, newName);
        await fs.rename(dirPath, newDirPath);
        dirPath = newDirPath;
        skillFilePath = path.join(dirPath, SKILL_FILE_NAME);
        this.loadedSkills.delete(oldName);
      }

      await fs.writeFile(skillFilePath, markdownContent, 'utf-8');

      const previousStats = this.skillFileStats.get(oldName);
      const stat = await fs.stat(skillFilePath);
      if (oldName !== newName) {
        this.skillFileStats.delete(oldName);
      }
      this.skillFileStats.set(newName, {
        createdAt: previousStats?.createdAt ?? stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      });

      const skill: UserSkillDefinition = {
        metadata,
        content: body,
        directoryName: newName,
        directoryPath: dirPath,
        filePath: skillFilePath,
        risk: this.parseRiskLevel(metadata),
      };

      this.loadedSkills.set(newName, skill);

      await appendMainLog('INFO', `Updated user skill: ${newName} at ${skillFilePath}`);

      this.emitSkillsChanged({ reason: 'updated', name: newName });

      return { ok: true, data: skill };
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新失败';
      await appendMainLog('ERROR', `Failed to update skill: ${message}`);
      return { ok: false, error: message };
    }
  }

  async deleteSkill(directoryName: string): Promise<SkillOperationResult> {
    try {
      const skill = this.getSkillByDirectoryName(directoryName);
      if (!skill) {
        return { ok: false, error: `Skill 目录 "${directoryName}" 不存在` };
      }

      await fs.rm(skill.directoryPath, { recursive: true, force: true });
      this.loadedSkills.delete(skill.metadata.name);
      this.skillFileStats.delete(skill.metadata.name);

      await appendMainLog('INFO', `Deleted user skill: ${skill.metadata.name}`);

      this.emitSkillsChanged({ reason: 'deleted', name: skill.metadata.name });

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除失败';
      await appendMainLog('ERROR', `Failed to delete skill: ${message}`);
      return { ok: false, error: message };
    }
  }

  async reloadSkills(): Promise<void> {
    this.loadedSkills.clear();
    this.skillFileStats.clear();
    await this.scanAndLoadSkills();
  }

  private async pathExists(target: string): Promise<boolean> {
    try {
      await fs.stat(target);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 安装一棵已下载、已扫描的 Skill 文件树。防重名、原子落盘并注册内存态。
   * files 中必须含根级 SKILL.md；relativePath 需由调用方消毒（此处再做逃逸兜底）。
   */
  async installSkillTree(files: InstalledSkillFile[]): Promise<SkillOperationResult> {
    try {
      const skillFile = files.find((f) => f.relativePath.toLowerCase() === SKILL_FILE_NAME.toLowerCase());
      if (!skillFile || typeof skillFile.text !== 'string') {
        return { ok: false, error: '安装包缺少根级 SKILL.md' };
      }

      const { metadata, body } = this.parseSkillMarkdown(skillFile.text);
      const name = (metadata.name ?? '').trim();
      if (!name) {
        return { ok: false, error: 'SKILL.md 缺少 name' };
      }
      if (!metadata.description) {
        return { ok: false, error: 'SKILL.md 缺少 description' };
      }
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
        return { ok: false, error: `名称格式错误：${name}` };
      }
      if (this.loadedSkills.has(name)) {
        return { ok: false, error: `Skill 名称 "${name}" 已存在` };
      }

      const dirPath = path.join(this.skillsDir, name);
      if (await this.pathExists(dirPath)) {
        return { ok: false, error: `目标目录已存在：${name}` };
      }

      // 重建 SKILL.md，剥离已废弃的 enabled 键，保留其余 frontmatter（execute/license/allowedTools 等）
      const patchedMeta = { ...metadata };
      const patchedMarkdown = `---\n${stringifyYaml(patchedMeta as Record<string, unknown>)}---\n\n${body.trim()}\n`;

      await fs.mkdir(this.skillsDir, { recursive: true });
      const tmpPath = path.join(this.skillsDir, `.installing-${name}`);
      await fs.rm(tmpPath, { recursive: true, force: true });
      await fs.mkdir(tmpPath, { recursive: true });

      const tmpResolved = path.resolve(tmpPath);
      for (const file of files) {
        const target = path.resolve(tmpPath, file.relativePath);
        if (target !== tmpResolved && !target.startsWith(tmpResolved + path.sep)) {
          await fs.rm(tmpPath, { recursive: true, force: true });
          return { ok: false, error: `非法文件路径：${file.relativePath}` };
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        if (file === skillFile) {
          await fs.writeFile(target, patchedMarkdown, 'utf-8');
        } else if (typeof file.text === 'string') {
          await fs.writeFile(target, file.text, 'utf-8');
        } else if (typeof file.contentBase64 === 'string') {
          await fs.writeFile(target, Buffer.from(file.contentBase64, 'base64'));
        }
      }

      await fs.rename(tmpPath, dirPath);

      const skill = await this.loadSkillFromDirectory(dirPath);
      if (!skill) {
        return { ok: false, error: '安装后加载失败，请检查 SKILL.md' };
      }

      await appendMainLog('INFO', `Installed user skill: ${name} (${files.length} files) at ${dirPath}`);
      this.emitSkillsChanged({ reason: 'installed', name });

      return { ok: true, data: skill };
    } catch (error) {
      const message = error instanceof Error ? error.message : '安装失败';
      await appendMainLog('ERROR', `Failed to install skill tree: ${message}`);
      return { ok: false, error: message };
    }
  }
}

export const userSkillsService = new UserSkillsService();
