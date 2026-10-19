/**
 * Skill 安装来源解析与传输安全（纯逻辑，无 Electron / fs 依赖，可单测）。
 * 覆盖：来源归一化、域白名单、SSRF 主机拦截、zip 条目消毒、体积/数量上限常量。
 */
import type { ResolvedSource } from '../../shared/user-skills';

/** 允许下载的域白名单。 */
export const ALLOWED_HOSTS = new Set<string>([
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
  'gist.githubusercontent.com',
  'skills.sh',
  'www.skills.sh',
  'mcp-proxy.baidu-int.com',
]);

/** 下载的 zipball 上限（解包前）。 */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
/** 安装物所有文件解包后的总体积上限。 */
export const MAX_SKILL_TOTAL_BYTES = 5 * 1024 * 1024;
/** 单个文件体积上限。 */
export const MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024;
/** Skill 允许包含的文件数量上限。 */
export const MAX_SKILL_FILE_COUNT = 200;

const TEXT_FILE_EXTENSIONS = new Set<string>([
  '.md', '.markdown', '.txt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.csv', '.xml', '.html', '.css',
]);

/** 判断文件是否按文本处理（用于扫描与写入编码选择）。 */
export function isTextFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }
  return TEXT_FILE_EXTENSIONS.has(lower.slice(dot));
}

/** 主机是否在白名单内（大小写不敏感）。 */
export function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.has(hostname.toLowerCase());
}

/** GitHub 自有域：仅向这些主机附带 Authorization token，避免把凭据泄露给 skills.sh / mcp-proxy 等其它白名单域。 */
export const GITHUB_HOSTS = new Set<string>([
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
  'gist.githubusercontent.com',
]);

/** 主机是否为 GitHub 自有域（大小写不敏感）。 */
export function isGithubHost(hostname: string): boolean {
  return GITHUB_HOSTS.has(hostname.toLowerCase());
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) {
    return false;
  }
  const parts = m.slice(1).map((n) => Number(n));
  if (parts.some((n) => n > 255)) {
    return true; // 非法 IP 一律视为不安全
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true; // 链路本地 + 云元数据 169.254.169.254
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  return a === 192 && b === 168;
}

/** 拦截指向内网 / 环回 / 链路本地 / 云元数据的主机。域名类主机交由白名单把关。 */
export function assertNoSsrf(hostname: string): void {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error(`拒绝访问内网主机：${hostname}`);
  }
  if (isPrivateIpv4(host)) {
    throw new Error(`拒绝访问内网/环回地址：${hostname}`);
  }
  if (host.includes(':')) {
    // IPv6 字面量：环回 ::1、唯一本地 fc00::/7、链路本地 fe80::/10
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')
      || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) {
      throw new Error(`拒绝访问内网/环回地址：${hostname}`);
    }
  }
}

/** 校验 URL：必须 https、主机在白名单、且非内网。返回解析后的 URL。 */
export function assertAllowedUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`非法 URL：${rawUrl}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`仅允许 https 来源：${rawUrl}`);
  }
  if (!isAllowedHost(url.hostname)) {
    throw new Error(`来源域不在白名单内：${url.hostname}`);
  }
  assertNoSsrf(url.hostname);
  return url;
}

/** 把用户输入的来源字符串归一化为 ResolvedSource；非法或不支持时抛错。 */
export function resolveSkillSource(input: string): ResolvedSource {
  const trimmed = input.trim();
  const url = assertAllowedUrl(trimmed);
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  const last = (segments[segments.length - 1] ?? '').toLowerCase();

  // GitHub 仓库 / 子目录（按子目录经 Contents API 拉取）
  if (host === 'github.com') {
    if (segments.length < 2) {
      throw new Error('GitHub 来源需形如 https://github.com/{owner}/{repo}[/tree/{ref}/{subdir}]。');
    }
    const [owner, repoRaw, marker, ref, ...rest] = segments;
    const repo = repoRaw.replace(/\.git$/, '');
    if (!owner || !repo) {
      throw new Error('无法解析 GitHub owner/repo。');
    }
    if (segments.length === 2) {
      return { kind: 'github', owner, repo, ref: 'HEAD', subdir: '' };
    }
    if (marker !== 'tree' || !ref) {
      throw new Error('仅支持仓库根或 /tree/{ref}/{subdir} 形式的 GitHub 来源。');
    }
    return { kind: 'github', owner, repo, ref, subdir: rest.join('/') };
  }

  // 打包为 .zip 的 Skill（如 mcp-proxy 永久下载链接）
  if (last.endsWith('.zip')) {
    return { kind: 'zip', url: url.toString() };
  }

  // 直接指向 SKILL.md 的 raw 链接
  if (last === 'skill.md') {
    return { kind: 'raw-md', url: url.toString() };
  }

  throw new Error('无法识别的来源：请提供 GitHub 仓库/子目录、.zip 包或 SKILL.md 直链。');
}

/** 消毒 zip 条目路径：拒绝绝对路径与 `..` 逃逸，统一为 posix 相对路径；非法返回 null。 */
export function sanitizeZipEntryPath(name: string): string | null {
  if (!name) {
    return null;
  }
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.startsWith('//') || /^[a-zA-Z]:/.test(normalized)) {
    return null;
  }
  const parts = normalized.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length === 0 || parts.some((p) => p === '..')) {
    return null;
  }
  return parts.join('/');
}

/**
 * 从 zip 条目列表定位 Skill 根目录前缀（含末尾 '/'，根级为空串）：
 * 取最浅的 SKILL.md 所在目录。找不到返回 null；同一最浅深度存在多个 SKILL.md（歧义）也返回 null。
 */
export function resolveZipSkillBase(entryPaths: string[]): string | null {
  const skillMds = entryPaths.filter(
    (p) => !p.endsWith('/') && (p.split('/').pop() ?? '').toLowerCase() === 'skill.md',
  );
  if (skillMds.length === 0) {
    return null;
  }
  const depthOf = (p: string): number => p.split('/').length;
  const minDepth = Math.min(...skillMds.map(depthOf));
  const shallowest = skillMds.filter((p) => depthOf(p) === minDepth);
  if (shallowest.length > 1) {
    return null;
  }
  const only = shallowest[0];
  const idx = only.toLowerCase().lastIndexOf('skill.md');
  return only.slice(0, idx);
}


