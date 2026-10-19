/**
 * Skill 安装编排（主进程）：安全下载 → 解包 → 校验 → 扫描 → 内存暂存 → 落盘。
 * 网络与文件副作用集中在此；纯逻辑委托 skill-source / skill-scanner。
 */
import type { InstalledSkillFile, ResolvedSource, ScanReport } from '../../shared/user-skills';
import type { ToolResult } from '../../shared/tools';
import { appendMainLog } from '../core/audit-log';
import { getGithubToken } from '../core/config-service';
import { userSkillsService } from './user-skills-service';
import { scanSkill } from './skill-scanner';
import {
  MAX_DOWNLOAD_BYTES,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_FILE_COUNT,
  MAX_SKILL_TOTAL_BYTES,
  assertAllowedUrl,
  assertNoSsrf,
  isGithubHost,
  isTextFile,
  resolveSkillSource,
  resolveZipSkillBase,
  sanitizeZipEntryPath,
} from './skill-source';

const SKILL_FILE_NAME = 'SKILL.md';
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export type InstallPreview = {
  summary: string;
  detail: string;
  skillMarkdown: string;
};

type StagedInstall = {
  name: string;
  files: InstalledSkillFile[];
  report: ScanReport;
};

/** buildConfirmation 阶段下载+扫描后的暂存，供 execute 阶段读同一份字节落盘（关闭 TOCTOU）。 */
const stagingCache = new Map<string, StagedInstall>();

function normalizeKey(source: string): string {
  return source.trim();
}

/**
 * 识别 GitHub API 限流响应（403/429 且额度剩余为 0），换算 reset 时间给出友好提示；
 * 非限流（如私有仓库权限 403）返回 null，交由通用错误处理。
 */
function describeGithubRateLimit(response: Response): string | null {
  if (response.status !== 403 && response.status !== 429) {
    return null;
  }
  if (response.headers.get('x-ratelimit-remaining') !== '0') {
    return null;
  }
  const resetSec = Number(response.headers.get('x-ratelimit-reset') ?? '');
  let when = '';
  if (Number.isFinite(resetSec) && resetSec > 0) {
    const resetMs = resetSec * 1000;
    const waitMin = Math.ceil((resetMs - Date.now()) / 60_000);
    const clock = new Date(resetMs).toLocaleTimeString();
    when = waitMin > 0 ? `，约 ${waitMin} 分钟后（${clock}）恢复` : `（${clock} 应已恢复）`;
  }
  return `GitHub API 限流：匿名调用额度（60 次/小时）已用尽${when}。可稍后重试，或配置 GitHub token 将额度提升到 5000 次/小时。`;
}

/** 手动重定向下载：逐跳复检白名单与 SSRF，限制体积、重定向次数与总耗时。 */
async function secureFetch(rawUrl: string, signal: AbortSignal | undefined, maxBytes: number): Promise<Buffer> {
  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const effectiveSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const githubToken = await getGithubToken();
  let currentUrl = rawUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const url = assertAllowedUrl(currentUrl);
    assertNoSsrf(url.hostname);
    const headers: Record<string, string> = { 'user-agent': 'ergaster-skill-installer', accept: '*/*' };
    // 仅向 GitHub 自有域附带凭据；逐跳复检，重定向到非 GitHub 域时自动不再携带，避免 token 外泄。
    if (githubToken && isGithubHost(url.hostname)) {
      headers.authorization = `Bearer ${githubToken}`;
    }
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: effectiveSignal,
      headers,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('重定向缺少 Location 头。');
      }
      currentUrl = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      if (response.status === 401 && githubToken) {
        throw new Error('GitHub 拒绝凭据（401）：GitHub token 可能无效或已过期，请在设置中更新后重试。');
      }
      throw new Error(describeGithubRateLimit(response) ?? `下载失败，HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`下载体积超限（${contentLength} 字节）。`);
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new Error(`下载体积超限（${arrayBuffer.byteLength} 字节）。`);
    }
    return Buffer.from(arrayBuffer);
  }
  throw new Error('重定向次数过多。');
}

async function fetchRawSkillMd(url: string, signal?: AbortSignal): Promise<InstalledSkillFile[]> {
  const buffer = await secureFetch(url, signal, MAX_SKILL_FILE_BYTES);
  return [{ relativePath: SKILL_FILE_NAME, text: buffer.toString('utf-8') }];
}

/** 下载 .zip 包并解包（jszip + zip-slip 消毒）：以最浅 SKILL.md 所在目录为根抽取整棵子树。 */
async function fetchZipSkill(url: string, signal?: AbortSignal): Promise<InstalledSkillFile[]> {
  const buffer = await secureFetch(url, signal, MAX_DOWNLOAD_BYTES);
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);

  const entryPaths = Object.keys(zip.files);
  const base = resolveZipSkillBase(entryPaths);
  if (base === null) {
    throw new Error('压缩包内未找到唯一的 SKILL.md，请确认 zip 结构。');
  }

  const files: InstalledSkillFile[] = [];
  let totalBytes = 0;
  for (const entryPath of entryPaths) {
    const entry = zip.files[entryPath];
    if (entry.dir || !entryPath.startsWith(base)) {
      continue;
    }
    const relativePath = sanitizeZipEntryPath(entryPath.slice(base.length));
    if (!relativePath) {
      continue;
    }
    if (files.length >= MAX_SKILL_FILE_COUNT) {
      throw new Error('Skill 文件数量超限。');
    }
    const content = await entry.async('nodebuffer');
    if (content.byteLength > MAX_SKILL_FILE_BYTES) {
      throw new Error(`文件超过单文件体积上限：${relativePath}`);
    }
    totalBytes += content.byteLength;
    if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
      throw new Error('Skill 总体积超限。');
    }
    files.push(isTextFile(relativePath)
      ? { relativePath, text: content.toString('utf-8') }
      : { relativePath, contentBase64: content.toString('base64') });
  }

  if (!files.some((f) => f.relativePath.toLowerCase() === SKILL_FILE_NAME.toLowerCase())) {
    throw new Error('压缩包内未找到根级 SKILL.md。');
  }
  return files;
}

type GithubContentEntry = {
  type: string; // 'file' | 'dir' | 'symlink' | 'submodule'
  name: string;
  path: string;
  size: number;
  download_url: string | null;
};

/** 把仓库相对路径按段编码但保留分隔符，供 GitHub Contents API 使用。 */
function encodeContentsPath(repoPath: string): string {
  return repoPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

/** 列出 GitHub 仓库某目录的直接子项（不递归）。 */
async function githubContents(
  source: Extract<ResolvedSource, { kind: 'github' }>,
  repoPath: string,
  signal?: AbortSignal,
): Promise<GithubContentEntry[]> {
  const encodedPath = encodeContentsPath(repoPath);
  const refQuery = source.ref && source.ref !== 'HEAD' ? `?ref=${encodeURIComponent(source.ref)}` : '';
  const url = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/contents${encodedPath ? `/${encodedPath}` : ''}${refQuery}`;
  const buffer = await secureFetch(url, signal, MAX_DOWNLOAD_BYTES);
  const parsed = JSON.parse(buffer.toString('utf-8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('指定路径不是目录，请指向包含 SKILL.md 的目录。');
  }
  return parsed as GithubContentEntry[];
}

/**
 * 只按子目录逐文件拉取 GitHub Skill（Contents API + raw 下载），不再下载整仓 zipball。
 * 小 Skill 从大仓安装时不受整仓体积影响，仅受单文件/总量/文件数上限约束。
 */
async function fetchGithubSkillTree(
  source: Extract<ResolvedSource, { kind: 'github' }>,
  signal?: AbortSignal,
): Promise<InstalledSkillFile[]> {
  const files: InstalledSkillFile[] = [];
  let totalBytes = 0;

  const walk = async (repoPath: string, relBase: string): Promise<void> => {
    const entries = await githubContents(source, repoPath, signal);
    for (const entry of entries) {
      const relativePath = sanitizeZipEntryPath(relBase ? `${relBase}/${entry.name}` : entry.name);
      if (!relativePath) {
        continue;
      }
      if (entry.type === 'dir') {
        await walk(entry.path, relativePath);
        continue;
      }
      if (entry.type !== 'file' || !entry.download_url) {
        continue; // 跳过 symlink / submodule 等
      }
      if (files.length >= MAX_SKILL_FILE_COUNT) {
        throw new Error('Skill 文件数量超限。');
      }
      if (entry.size > MAX_SKILL_FILE_BYTES) {
        throw new Error(`文件超过单文件体积上限：${relativePath}`);
      }
      const content = await secureFetch(entry.download_url, signal, MAX_SKILL_FILE_BYTES);
      totalBytes += content.byteLength;
      if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
        throw new Error('Skill 总体积超限。');
      }
      files.push(isTextFile(relativePath)
        ? { relativePath, text: content.toString('utf-8') }
        : { relativePath, contentBase64: content.toString('base64') });
    }
  };

  await walk(source.subdir, '');

  if (!files.some((f) => f.relativePath.toLowerCase() === SKILL_FILE_NAME.toLowerCase())) {
    throw new Error('指定目录内未找到根级 SKILL.md，请指向恰好包含 SKILL.md 的目录。');
  }
  return files;
}


/**
 * 下载 + 校验 + 扫描 + 暂存，返回确认弹窗预览。命中阻断级风险直接抛错（预检失败，不弹窗、不安装）。
 * 供工具的 buildConfirmation 调用。
 */
export async function prepareInstall(source: string, signal?: AbortSignal): Promise<InstallPreview> {
  const resolved = resolveSkillSource(source);
  let files: InstalledSkillFile[];
  if (resolved.kind === 'raw-md') {
    files = await fetchRawSkillMd(resolved.url, signal);
  } else if (resolved.kind === 'zip') {
    files = await fetchZipSkill(resolved.url, signal);
  } else {
    files = await fetchGithubSkillTree(resolved, signal);
  }

  const skillFile = files.find((f) => f.relativePath.toLowerCase() === SKILL_FILE_NAME.toLowerCase());
  if (!skillFile || typeof skillFile.text !== 'string') {
    throw new Error('安装包缺少可读的根级 SKILL.md。');
  }

  const { metadata, body } = userSkillsService.parseSkillMarkdown(skillFile.text);
  const name = (metadata.name ?? '').trim();
  if (!name || !metadata.description) {
    throw new Error('SKILL.md 缺少 name 或 description。');
  }
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
    throw new Error(`Skill 名称不合法：${name}`);
  }
  if (userSkillsService.listNames().includes(name)) {
    throw new Error(`Skill 名称「${name}」已存在，请先卸载或改名后再安装。`);
  }

  const report = scanSkill({
    metadata,
    body,
    files: files.map((f) => ({ relativePath: f.relativePath, text: f.text })),
    existingNames: userSkillsService.listNames(),
  });
  if (report.blocked) {
    throw new Error(buildBlockedMessage(name, report));
  }

  stagingCache.set(normalizeKey(source), { name, files, report });
  await appendMainLog('INFO', `Skill install staged: ${name} files=${files.length} score=${report.score}`);

  const hint = report.findings.length ? `，${report.findings.length} 条安全提示` : '';
  return {
    summary: `将安装 Skill「${name}」：${files.length} 个文件，风险分 ${report.score}${hint}`,
    detail: buildReportDetail(resolved, files, report),
    skillMarkdown: skillFile.text,
  };
}

/** 读取暂存并落盘。无暂存则报错，绝不重新下载后静默安装（防 TOCTOU）。供工具的 execute 调用。 */
export async function commitInstall(source: string): Promise<ToolResult> {
  const key = normalizeKey(source);
  const staged = stagingCache.get(key);
  if (!staged) {
    return { ok: false, content: '', error: '安装暂存已失效（未经确认或已被清理），请让模型重新发起安装。' };
  }

  const result = await userSkillsService.installSkillTree(staged.files);
  stagingCache.delete(key);

  if (!result.ok) {
    return { ok: false, content: '', error: result.error ?? '安装失败' };
  }
  return {
    ok: true,
    content: `已安装 Skill「${staged.name}」。该 Skill 已就绪但尚未授权给任何智能体；如需使用，请提示用户在「智能体管理」中为相应智能体勾选该 Skill。`,
    data: { name: staged.name, fileCount: staged.files.length, riskScore: staged.report.score },
  };
}

function buildBlockedMessage(name: string, report: ScanReport): string {
  const lines = report.findings
    .filter((f) => f.severity === 'block')
    .map((f) => `- [${f.code}] ${f.message}${f.file ? `（${f.file}）` : ''}`);
  return `Skill「${name}」安全扫描未通过，已阻断安装：\n${lines.join('\n')}`;
}

function estimateFileSize(file: InstalledSkillFile): number {
  if (typeof file.text === 'string') {
    return Buffer.byteLength(file.text, 'utf-8');
  }
  if (typeof file.contentBase64 === 'string') {
    return Math.floor((file.contentBase64.length * 3) / 4);
  }
  return 0;
}

function buildReportDetail(resolved: ResolvedSource, files: InstalledSkillFile[], report: ScanReport): string {
  const sourceLine = resolved.kind === 'github'
    ? `来源：github ${resolved.owner}/${resolved.repo}@${resolved.ref}${resolved.subdir ? `/${resolved.subdir}` : ''}`
    : `来源：${resolved.url}`;
  const fileLines = files.map((f) => `- ${f.relativePath}（${estimateFileSize(f)} 字节）`);
  const findingLines = report.findings.length
    ? report.findings.map((f) => `- [${f.severity}] ${f.code}: ${f.message}${f.file ? `（${f.file}）` : ''}`)
    : ['- 无'];
  return [
    sourceLine,
    `风险分：${report.score}`,
    '',
    `文件（${files.length}）：`,
    ...fileLines,
    '',
    '安全发现：',
    ...findingLines,
    '',
    '注意：安装后不会自动授权给任何智能体。请审阅上方 SKILL.md 正文，确认后安装，再到「智能体管理」中为相应智能体勾选该 Skill。',
  ].join('\n');
}




