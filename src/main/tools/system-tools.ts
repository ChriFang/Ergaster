import { shell } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from '../core/config-service';
import { decodeImageDraft, ensureXlsxExtension, expandHomePath, isTimeoutAbort, pathExists, resolveChildPath, resolveTextDraftExtension, sanitizeDraftRelativePath, sanitizeFileName, summarizeJson, truncateText } from './tool-helpers';
import {
  applyExcelCellUpdates,
  buildExcelBuffer,
  excelReadableExtensions,
  excelUpdatableExtensions,
  maxExcelFileSizeBytes,
  readCsvBuffer,
  readXlsxBuffer,
  type ExcelCellUpdate,
  type ExcelDraftSheet,
  type ExcelExtractOptions,
} from './excel-utils';
import {
  buildDocxBuffer,
  buildPdfBuffer,
  describeDocumentBlockSchemaError,
  documentBlocksSchema,
} from './document-utils';
import type { ToolResult } from '../../shared/tools';
import { commandToolTimeoutMs } from '../../shared/tools';
import { appendMainLog } from '../core/audit-log';
import { getAppDataRoot } from '../core/app-paths';
import { extractZipToDir } from './archive-engine';
import { downloadToDirectory } from './download-engine';
import {
  countMatchesInScope,
  globInScope,
  grepInScope,
  listDirInScope,
  readFileInScope,
} from '../code/file-scope-engine';
import { defaultIgnoredDirectories, createIgnoreMatcher, maxTextScanFileBytes, type FileScope } from '../code/code-tools-utils';

export const allowedApplicationNames = ['notepad', 'calculator', 'explorer', 'powershell'] as const;
export const availablePowershellTemplates = ['listProcesses', 'listServices'] as const;

const textResponsePreviewLimit = 8000;
const commandOutputPreviewLimit = 12000;
const maxFileReadSizeBytes = 1024 * 1024; // 1MB
const maxPdfExtractPreviewLength = 12000;
const headerSummaryAllowlist = ['content-type', 'content-length', 'last-modified', 'etag', 'cache-control'] as const;
const blockedRequestHeaderNames = new Set(['host', 'content-length']);
const sensitiveRequestHeaderNames = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key']);

type HttpRequestQuery = Record<string, string>;
type HttpRequestHeaders = Record<string, string>;

function getWindowsDirectory() {
  return process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
}

const applicationWhitelist: Record<(typeof allowedApplicationNames)[number], string> = {
  notepad: path.join(getWindowsDirectory(), 'System32', 'notepad.exe'),
  calculator: path.join(getWindowsDirectory(), 'System32', 'calc.exe'),
  explorer: path.join(getWindowsDirectory(), 'explorer.exe'),
  powershell: path.join(getWindowsDirectory(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
};

const powershellTemplates: Record<(typeof availablePowershellTemplates)[number], string> = {
  listProcesses: 'Get-Process | Select-Object -First 10 Name, Id, CPU | ConvertTo-Json -Depth 2',
  listServices: 'Get-Service | Select-Object -First 10 Name, Status | ConvertTo-Json -Depth 2',
};

function normalizeWindowsPath(targetPath: string) {
  return path.resolve(targetPath).toLowerCase();
}

const runtimeAllowedFiles = new Set<string>();

export function addRuntimeAllowedFile(targetPath: string) {
  runtimeAllowedFiles.add(path.resolve(targetPath));
}

export function clearRuntimeAllowedFiles() {
  runtimeAllowedFiles.clear();
}

function isRuntimeAllowedFile(targetPath: string) {
  return runtimeAllowedFiles.has(path.resolve(targetPath));
}

function sanitizeHeaderValue(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function sanitizeHeaderName(value: string) {
  return value.trim().toLowerCase();
}

function sanitizeRequestHeaders(headers?: HttpRequestHeaders) {
  const sanitized: Record<string, string> = {
    accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
  };

  if (!headers) {
    return sanitized;
  }

  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = sanitizeHeaderName(rawName);

    if (!name || blockedRequestHeaderNames.has(name)) {
      continue;
    }

    const value = sanitizeHeaderValue(rawValue);

    if (!value) {
      continue;
    }

    sanitized[name] = value;
  }

  return sanitized;
}

function summarizeResponseHeaders(headers: Headers) {
  const summary: Record<string, string> = {};

  for (const name of headerSummaryAllowlist) {
    const value = headers.get(name);

    if (value) {
      summary[name] = value;
    }
  }

  return summary;
}

function summarizeRequestHeaders(headers: Record<string, string>) {
  const summary: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    summary[name] = sensitiveRequestHeaderNames.has(name) ? '***' : value;
  }

  return summary;
}

function buildHttpRequestContent(
  finalUrl: string,
  response: Response,
  contentType: string,
  bodyPreview: string,
  truncated: boolean,
) {
  const lines = [
    `请求地址: ${finalUrl}`,
    `HTTP 状态: ${response.status} ${response.statusText}`,
    `Content-Type: ${contentType || 'unknown'}`,
    '响应正文预览:',
    bodyPreview || '[empty]',
  ];

  if (truncated) {
    lines.push('注: 响应内容已截断。');
  }

  return lines.join('\n');
}

async function getAllowedPaths() {
  const config = await loadConfig();
  const configured = config.toolSettings?.allowedPaths ?? [];
  const fallback = [
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Documents'),
  ];
  const base = (configured.length > 0 ? configured : fallback).map((value) => path.resolve(expandHomePath(value)));
  // 草稿、会话与 skills 目录始终纳入可访问范围：确保 agent 能读回自己写入的草稿、当前会话附件与已安装的 skill 文件
  const draftDir = await getDraftDirectory();
  const conversationsDir = path.resolve(path.join(getAppDataRoot(), 'conversations'));
  const skillsDir = path.resolve(path.join(getAppDataRoot(), 'skills'));
  return Array.from(new Set([...base, draftDir, conversationsDir, skillsDir]));
}

async function getSearchRoots() {
  const config = await loadConfig();
  const configured = config.toolSettings?.searchRoots ?? [];
  const fallback = [
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Documents'),
  ];
  const base = (configured.length > 0 ? configured : fallback).map((value) => path.resolve(expandHomePath(value)));
  // 草稿、会话与 skills 目录始终纳入搜索范围
  const draftDir = await getDraftDirectory();
  const conversationsDir = path.resolve(path.join(getAppDataRoot(), 'conversations'));
  const skillsDir = path.resolve(path.join(getAppDataRoot(), 'skills'));
  return Array.from(new Set([...base, draftDir, conversationsDir, skillsDir]));
}

async function getDraftDirectory() {
  const config = await loadConfig();
  return path.resolve(expandHomePath(config.toolSettings?.draftDirectory ?? path.join(os.homedir(), 'Documents', 'ErgasterDrafts')));
}

export async function assertWithinAllowedPaths(targetPath: string) {
  const resolvedPath = path.resolve(expandHomePath(targetPath));

  if (isRuntimeAllowedFile(resolvedPath)) {
    if (!(await pathExists(resolvedPath))) {
      throw new Error('目标路径不存在。');
    }
    return resolvedPath;
  }

  const normalizedTarget = normalizeWindowsPath(resolvedPath);
  const allowedPaths = await getAllowedPaths();
  const matched = allowedPaths.some((allowedPath) => {
    const normalizedAllowed = normalizeWindowsPath(allowedPath);
    return normalizedTarget === normalizedAllowed || normalizedTarget.startsWith(`${normalizedAllowed}${path.sep}`);
  });

  if (!matched) {
    throw new Error('目标路径不在允许访问的目录范围内。');
  }

  if (!(await pathExists(resolvedPath))) {
    throw new Error('目标路径不存在。');
  }

  return resolvedPath;
}

/**
 * 通用模式的文件沙箱：路径必须落在全局 allowedPaths 内（经 assertWithinAllowedPaths 校验）。
 * 与 Code 模式的 ProjectScope 不同：没有单一工程根，展示路径用绝对路径；
 * 忽略规则只用默认排除目录（日志等目录通常没有 .gitignore）。
 * 遍历引擎（walkScope）要求 relativize 对任意子路径稳定，这里用「相对 scope 根」保证子路径相对化正确。
 */
function createAllowedPathsScope(rootAbsolutePath: string): FileScope {
  const ignoreMatcher = createIgnoreMatcher(
    defaultIgnoredDirectories.map((name) => ({ pattern: name, negated: false, directoryOnly: false, anchored: false })),
  );

  return {
    async resolve(input: string) {
      // 相对路径按 scope 根解析，再统一经 allowedPaths 校验；绝对路径同样必须落在 allowedPaths 内
      const candidate = path.isAbsolute(expandHomePath(input)) || input.trim() === ''
        ? (input.trim() === '' ? rootAbsolutePath : input)
        : path.resolve(rootAbsolutePath, input);
      return assertWithinAllowedPaths(candidate);
    },
    relativize(absolutePath: string) {
      const relative = path.relative(rootAbsolutePath, absolutePath);
      // 根自身返回其绝对路径；子路径返回相对根的 "/" 分隔路径
      if (relative === '') {
        return absolutePath.split(path.sep).join('/');
      }
      return relative.split(path.sep).join('/');
    },
    async getIgnoreMatcher() {
      return ignoreMatcher;
    },
  };
}

/** 通用只读工具的入口目录校验：必须是 allowedPaths 内的已存在目录。 */
async function resolveAllowedDirectory(dirPath: string): Promise<string> {
  const resolved = await assertWithinAllowedPaths(dirPath);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error('目标路径不是目录。');
  }
  return resolved;
}

/** 在允许目录内按正则检索文件内容（Select-String 的替代）。 */
export async function grepFiles(
  args: { dirPath: string; pattern: string; include?: string[]; exclude?: string[]; contextLines?: number; caseInsensitive?: boolean; maxResults?: number },
  signal?: AbortSignal,
): Promise<ToolResult> {
  try {
    const root = await resolveAllowedDirectory(args.dirPath);
    const scope = createAllowedPathsScope(root);
    return await grepInScope(scope, { ...args, dirPath: '.' }, signal ?? new AbortController().signal, { maxFileBytes: maxTextScanFileBytes });
  } catch (error) {
    const message = error instanceof Error ? error.message : '内容检索失败。';
    return { ok: false, content: '', error: message };
  }
}

/** 在允许目录内按 glob 递归查找文件（Get-ChildItem -Recurse + Where-Object 的替代）。 */
export async function globFiles(
  args: { dirPath: string; pattern: string; limit?: number },
  signal?: AbortSignal,
): Promise<ToolResult> {
  try {
    const root = await resolveAllowedDirectory(args.dirPath);
    const scope = createAllowedPathsScope(root);
    return await globInScope(scope, { pattern: args.pattern, dirPath: '.', limit: args.limit }, signal ?? new AbortController().signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : '按文件名检索失败。';
    return { ok: false, content: '', error: message };
  }
}

/** 在允许目录内跨文件统计正则命中数（Measure-Object / Group-Object 的替代）。 */
export async function countMatches(
  args: { dirPath: string; pattern: string; include?: string[]; exclude?: string[]; caseInsensitive?: boolean },
  signal?: AbortSignal,
): Promise<ToolResult> {
  try {
    const root = await resolveAllowedDirectory(args.dirPath);
    const scope = createAllowedPathsScope(root);
    return await countMatchesInScope(scope, { ...args, dirPath: '.' }, signal ?? new AbortController().signal, { maxFileBytes: maxTextScanFileBytes });
  } catch (error) {
    const message = error instanceof Error ? error.message : '统计匹配失败。';
    return { ok: false, content: '', error: message };
  }
}

/**
 * 把允许目录内的 .zip 解压到允许目录内的目标目录。写操作（risk: medium）。
 * 安全：路径经 allowedPaths 沙箱校验；解压引擎再对条目消毒（拒绝绝对路径/`..` 逃逸）、
 * zip-slip 双保险、文件数/单文件/总量上限。目标目录不存在则创建。
 */
export async function extractArchive(
  args: { archivePath: string; destDir: string },
  signal?: AbortSignal,
): Promise<ToolResult> {
  let archivePath: string;
  let destDir: string;
  try {
    archivePath = await assertWithinAllowedPaths(args.archivePath);
    // 目标目录可能尚不存在：校验其父目录在允许范围内，再按需创建
    destDir = await resolveWritableDestDir(args.destDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : '路径验证失败。';
    await appendMainLog('ERROR', `extract_archive path validation failed: ${message}`);
    return { ok: false, content: '', error: message };
  }

  if (!/\.zip$/i.test(archivePath)) {
    return { ok: false, content: '', error: '仅支持 .zip 压缩包。' };
  }

  try {
    const stat = await fs.stat(archivePath);
    if (!stat.isFile()) {
      return { ok: false, content: '', error: '压缩包路径不是文件。' };
    }

    signal?.throwIfAborted();
    const result = await extractZipToDir(archivePath, destDir, signal);
    if (result.ok) {
      const data = result.data as { fileCount?: number; totalBytes?: number } | undefined;
      await appendMainLog('INFO', `extract_archive success: ${archivePath} -> ${destDir}, ${data?.fileCount ?? 0} files, ${data?.totalBytes ?? 0} bytes`);
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('工具执行已取消。');
    }
    const message = error instanceof Error ? error.message : '解压失败。';
    await appendMainLog('ERROR', `extract_archive failed: ${archivePath}, error: ${message}`);
    return { ok: false, content: '', error: `解压失败：${message}` };
  }
}

/**
 * 解析解压目标目录：目录可不存在，但其（最近的已存在祖先）必须落在 allowedPaths 内。
 * 存在则直接校验；不存在则校验父目录在允许范围内后创建。
 */
async function resolveWritableDestDir(destDir: string): Promise<string> {
  const resolved = path.resolve(expandHomePath(destDir));
  if (await pathExists(resolved)) {
    const checked = await assertWithinAllowedPaths(resolved);
    const stat = await fs.stat(checked);
    if (!stat.isDirectory()) {
      throw new Error('目标路径已存在且不是目录。');
    }
    return checked;
  }
  // 目标不存在：校验父目录在允许范围内，再创建目标
  const parent = path.dirname(resolved);
  await assertWithinAllowedPaths(parent);
  await fs.mkdir(resolved, { recursive: true });
  return resolved;
}

/**
 * 下载文件落盘（risk: medium）。域名白名单的审批判定在 tool-registry 完成，这里只做：
 * 目标目录 allowedPaths 校验（默认草稿目录下的 downloads/）+ 调下载引擎（SSRF、重定向 host 策略、体积上限、流式原子写）。
 */
export async function downloadFile(
  args: { url: string; destDir?: string; fileName?: string },
  allowedHosts: readonly string[] | undefined,
  signal?: AbortSignal,
): Promise<ToolResult> {
  let destDir: string;
  try {
    if (args.destDir?.trim()) {
      destDir = await resolveWritableDestDir(args.destDir);
    } else {
      const draftDirectory = await getDraftDirectory();
      await fs.mkdir(draftDirectory, { recursive: true });
      destDir = await resolveWritableDestDir(path.join(draftDirectory, 'downloads'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '路径验证失败。';
    await appendMainLog('ERROR', `download_file path validation failed: ${message}`);
    return { ok: false, content: '', error: message };
  }

  try {
    const result = await downloadToDirectory({
      url: args.url,
      destDir,
      fileName: args.fileName,
      allowedHosts,
      signal,
    });
    await appendMainLog('INFO', `download_file success: ${result.finalUrl} -> ${result.filePath}, ${result.bytes} bytes`);
    return {
      ok: true,
      content: `已下载到：${result.filePath}（${(result.bytes / 1024 / 1024).toFixed(2)}MB）`,
      data: { path: result.filePath, bytes: result.bytes, finalUrl: result.finalUrl },
    };
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('工具执行已取消。');
    }
    const message = error instanceof Error ? error.message : '下载失败。';
    await appendMainLog('ERROR', `download_file failed: ${args.url}, error: ${message}`);
    return { ok: false, content: '', error: `下载失败：${message}` };
  }
}



async function openWithShell(targetPath: string) {
  const result = await shell.openPath(targetPath);

  if (result) {
    throw new Error(result);
  }
}

export async function openApplication(appName: (typeof allowedApplicationNames)[number]): Promise<ToolResult> {
  const executable = applicationWhitelist[appName];
  await appendMainLog('INFO', `open application: ${appName}, executable: ${executable}`);

  try {
    await openWithShell(executable);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知启动错误。';
    await appendMainLog('ERROR', `open application failed: ${appName}, executable: ${executable}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: `启动应用失败：${appName}（${message}）`,
      data: {
        appName,
        executable,
      },
    };
  }

  return {
    ok: true,
    content: `已启动应用：${appName}`,
    data: {
      appName,
      executable,
    },
  };
}

export async function openPath(targetPath: string): Promise<ToolResult> {
  const resolvedPath = await assertWithinAllowedPaths(targetPath);

  try {
    await openWithShell(resolvedPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知启动错误。';
    await appendMainLog('ERROR', `open path failed: ${resolvedPath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: `打开路径失败：${resolvedPath}（${message}）`,
      data: { path: resolvedPath },
    };
  }

  return {
    ok: true,
    content: `已打开路径：${resolvedPath}`,
    data: { path: resolvedPath },
  };
}

export async function readFile(
  filePath: string,
  signal?: AbortSignal,
  options?: { startLine?: number; maxLines?: number },
): Promise<ToolResult> {
  let resolvedPath: string;

  try {
    resolvedPath = await assertWithinAllowedPaths(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : '路径验证失败。';
    await appendMainLog('ERROR', `read_file path validation failed: ${filePath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  // 传了分页参数、或文件超过 1MB 整读上限时，走共享的按行分页引擎（上限 100MB，大文件流式读）；
  // 否则维持原整读行为，保证既有调用的向后兼容。
  const wantsPagination = options?.startLine !== undefined || options?.maxLines !== undefined;
  let needsPagination = wantsPagination;
  if (!needsPagination) {
    try {
      const stat = await fs.stat(resolvedPath);
      if (stat.isFile() && stat.size > maxFileReadSizeBytes) {
        needsPagination = true;
      }
    } catch {
      // stat 失败交给下方整读分支统一报错
    }
  }

  if (needsPagination) {
    const scope = createAllowedPathsScope(path.dirname(resolvedPath));
    return readFileInScope(
      scope,
      { filePath: resolvedPath, startLine: options?.startLine, maxLines: options?.maxLines },
      signal ?? new AbortController().signal,
      { maxFileBytes: maxTextScanFileBytes },
    );
  }

  try {
    const stat = await fs.stat(resolvedPath);

    if (!stat.isFile()) {
      return {
        ok: false,
        content: '',
        error: '目标路径不是文件。',
      };
    }

    signal?.throwIfAborted();

    const content = await fs.readFile(resolvedPath, 'utf-8');

    await appendMainLog('INFO', `read_file success: ${resolvedPath}, size: ${stat.size}`);

    return {
      ok: true,
      content,
      data: {
        path: resolvedPath,
        size: stat.size,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('工具执行已取消。');
    }

    const message = error instanceof Error ? error.message : '读取文件失败。';
    await appendMainLog('ERROR', `read_file failed: ${resolvedPath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: `读取文件失败：${message}`,
    };
  }
}

export async function getSystemInfo(): Promise<ToolResult> {
  const info = {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    username: os.userInfo().username,
    cpus: os.cpus().length,
    totalMemoryGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
    freeMemoryGb: Number((os.freemem() / 1024 / 1024 / 1024).toFixed(2)),
  };

  return {
    ok: true,
    content: summarizeJson(info),
    data: info,
  };
}

async function searchInDirectory(
  root: string,
  keyword: string,
  results: string[],
  limit: number,
  signal?: AbortSignal,
  depth = 0,
) {
  if (signal?.aborted) {
    throw new Error('工具执行已取消。');
  }

  if (results.length >= limit || depth > 4) {
    return;
  }

  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    if (signal?.aborted) {
      throw new Error('工具执行已取消。');
    }

    if (results.length >= limit) {
      break;
    }

    const fullPath = path.join(root, entry.name);

    if (entry.name.toLowerCase().includes(keyword)) {
      results.push(fullPath);
    }

    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      try {
        await searchInDirectory(fullPath, keyword, results, limit, signal, depth + 1);
      } catch (error) {
        if (error instanceof Error && error.message === '工具执行已取消。') {
          throw error;
        }
      }
    }
  }
}

export async function searchFiles(keyword: string, limit: number, signal?: AbortSignal): Promise<ToolResult> {
  const normalizedKeyword = keyword.trim().toLowerCase();

  if (!normalizedKeyword) {
    return {
      ok: false,
      content: '',
      error: '搜索关键词不能为空。',
    };
  }

  const roots = await getSearchRoots();
  const results: string[] = [];
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 20);

  for (const root of roots) {
    try {
      await searchInDirectory(root, normalizedKeyword, results, safeLimit, signal);
    } catch (error) {
      if (error instanceof Error && error.message === '工具执行已取消。') {
        throw error;
      }
    }

    if (results.length >= safeLimit) {
      break;
    }
  }

  return {
    ok: true,
    content: results.length > 0 ? results.join('\n') : '未找到匹配文件。',
    data: { results, searchedRoots: roots },
  };
}

export async function listDirectory(
  dirPath: string,
  signal?: AbortSignal,
  options?: { recursive?: boolean },
): Promise<ToolResult> {
  let resolvedPath: string;

  try {
    resolvedPath = await assertWithinAllowedPaths(dirPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : '路径验证失败。';
    await appendMainLog('ERROR', `list_dir path validation failed: ${dirPath}, error: ${message}`);
    return { ok: false, content: '', error: message };
  }

  // 递归列目录走共享的 walkScope 引擎（含默认排除目录与节点上限）
  if (options?.recursive) {
    const scope = createAllowedPathsScope(resolvedPath);
    return listDirInScope(scope, { dirPath: resolvedPath, recursive: true, limit: 1000 }, signal ?? new AbortController().signal);
  }

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      return { ok: false, content: '', error: '目标路径不是目录。' };
    }

    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
    const maxEntries = 500;
    const shown = entries.slice(0, maxEntries);
    const lines: string[] = [];

    for (const entry of shown) {
      signal?.throwIfAborted();
      const isDir = entry.isDirectory();
      let sizeLabel = isDir ? '<DIR>' : '?';
      let mtimeLabel = '';
      try {
        const childStat = await fs.stat(path.join(resolvedPath, entry.name));
        sizeLabel = isDir ? '<DIR>' : String(childStat.size);
        mtimeLabel = childStat.mtime.toISOString();
      } catch {
        // 无法 stat（权限/失效符号链接等）时仅列出名称
      }
      lines.push(`${isDir ? 'd' : '-'}\t${sizeLabel}\t${mtimeLabel}\t${entry.name}`);
    }

    const header = `目录：${resolvedPath}（共 ${entries.length} 项${entries.length > maxEntries ? `，仅显示前 ${maxEntries}` : ''}）`;
    return {
      ok: true,
      content: [header, ...lines].join('\n'),
      data: {
        path: resolvedPath,
        total: entries.length,
        truncated: entries.length > maxEntries,
        entries: shown.map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'dir' : 'file' })),
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('工具执行已取消。');
    }
    const message = error instanceof Error ? error.message : '读取目录失败。';
    await appendMainLog('ERROR', `list_dir failed: ${resolvedPath}, error: ${message}`);
    return { ok: false, content: '', error: message };
  }
}

export async function createTextDraft(fileName: string, content: string): Promise<ToolResult> {
  const draftDirectory = await getDraftDirectory();

  let safeName: string;

  try {
    safeName = resolveTextDraftExtension(sanitizeDraftRelativePath(fileName.trim() || 'draft'));
  } catch (error) {
    const message = error instanceof Error ? error.message : '草稿文件名不合法。';
    await appendMainLog('WARN', `create_text_draft rejected: ${fileName}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  const fullPath = resolveChildPath(draftDirectory, safeName);
  // 支持相对子目录：按 fullPath 的目录（含新建子目录）递归创建
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');

  return {
    ok: true,
    content: `已创建草稿：${fullPath}。如需向用户展示该文件，请立即调用 preview_text 并传入上述路径。`,
    data: { path: fullPath },
  };
}

export async function createExcelDraft(fileName: string, sheets: ExcelDraftSheet[]): Promise<ToolResult> {
  if (sheets.length === 0) {
    return {
      ok: false,
      content: '',
      error: '至少需要一个工作表。',
    };
  }

  const draftDirectory = await getDraftDirectory();

  const safeName = ensureXlsxExtension(sanitizeDraftRelativePath(fileName.trim() || 'draft'));

  let fullPath: string;

  try {
    fullPath = resolveChildPath(draftDirectory, safeName);
  } catch (error) {
    const message = error instanceof Error ? error.message : '目标路径超出允许目录范围。';
    await appendMainLog('ERROR', `create_excel_draft path rejected: ${fileName}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  try {
    const buffer = await buildExcelBuffer(sheets);
    await fs.writeFile(fullPath, buffer);

    const rowCount = sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
    await appendMainLog('INFO', `create_excel_draft success: ${fullPath}, sheets: ${sheets.length}, rows: ${rowCount}`);

    return {
      ok: true,
      content: `已创建 Excel 草稿：${fullPath}（${sheets.length} 个工作表，共 ${rowCount} 行）`,
      data: { path: fullPath, sheetCount: sheets.length, rowCount },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Excel 草稿创建失败。';
    await appendMainLog('ERROR', `create_excel_draft failed: ${fullPath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: `Excel 草稿创建失败：${message}`,
      data: { path: fullPath },
    };
  }
}

/** 文档草稿文件名后缀校验：无后缀补默认值，后缀不符直接报错。 */
function ensureFixedExtension(fileName: string, expected: '.docx' | '.pdf') {
  const extension = path.extname(fileName).toLowerCase();
  if (!extension) {
    return `${fileName}${expected}`;
  }
  if (extension === expected) {
    return fileName;
  }
  throw new Error(`文件名后缀应为 ${expected}（当前为 ${extension}）。`);
}

export async function createImageDraft(fileName: string, base64Data: string): Promise<ToolResult> {
  const draftDirectory = await getDraftDirectory();

  const safeName = sanitizeDraftRelativePath(fileName.trim() || 'image');

  let buffer: Buffer;

  try {
    ({ buffer } = decodeImageDraft(base64Data, safeName));
  } catch (error) {
    const message = error instanceof Error ? error.message : '图片草稿数据不合法。';
    await appendMainLog('WARN', `create_image_draft rejected: ${safeName}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  let fullPath: string;

  try {
    fullPath = resolveChildPath(draftDirectory, safeName);
  } catch (error) {
    const message = error instanceof Error ? error.message : '目标路径超出允许目录范围。';
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  try {
    await fs.writeFile(fullPath, buffer);
    return {
      ok: true,
      content: `已创建图片草稿：${fullPath}（${Math.round(buffer.length / 1024)}KB）。如需向用户展示，请立即调用 preview_image 并传入上述路径。`,
      data: { path: fullPath, bytes: buffer.length },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '图片草稿创建失败。';
    await appendMainLog('ERROR', `create_image_draft failed: ${fullPath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: `图片草稿创建失败：${message}`
    };
  }
}

export async function createDocxDraft(fileName: string, blocks: unknown): Promise<ToolResult> {
  const parsedBlocks = documentBlocksSchema.safeParse(blocks);
  if (!parsedBlocks.success) {
    return {
      ok: false,
      content: '',
      error: describeDocumentBlockSchemaError(parsedBlocks.error),
    };
  }

  const draftDirectory = await getDraftDirectory();

  let safeName: string;

  try {
    safeName = ensureFixedExtension(sanitizeDraftRelativePath(fileName.trim() || 'document'), '.docx');
  } catch (error) {
    const message = error instanceof Error ? error.message : '草稿文件名不合法。';
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  let fullPath: string;

  try {
    fullPath = resolveChildPath(draftDirectory, safeName);
  } catch (error) {
    const message = error instanceof Error ? error.message : '目标路径超出允许目录范围。';
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  try {
    const buffer = await buildDocxBuffer(parsedBlocks.data);
    await fs.writeFile(fullPath, buffer);
    await appendMainLog('INFO', `create_docx_draft success: ${fullPath}, blocks: ${parsedBlocks.data.length}`);
    return {
      ok: true,
      content: `已创建 Word 草稿：${fullPath}（${parsedBlocks.data.length} 个内容块）。如需向用户展示文档内容，请立即调用 preview_docx 并传入上述路径。`,
      data: { path: fullPath, blocks: parsedBlocks.data.length },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Word 草稿创建失败。';
    await appendMainLog('ERROR', `create_docx_draft failed: ${fullPath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: `Word 草稿创建失败：${message}`
    };
  }
}

export async function createPdfDraft(fileName: string, blocks: unknown): Promise<ToolResult> {
  const parsedBlocks = documentBlocksSchema.safeParse(blocks);
  if (!parsedBlocks.success) {
    return {
      ok: false,
      content: '',
      error: describeDocumentBlockSchemaError(parsedBlocks.error),
    };
  }

  const draftDirectory = await getDraftDirectory();

  let safeName: string;

  try {
    safeName = ensureFixedExtension(sanitizeDraftRelativePath(fileName.trim() || 'document'), '.pdf');
  } catch (error) {
    const message = error instanceof Error ? error.message : '草稿文件名不合法。';
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  let fullPath: string;

  try {
    fullPath = resolveChildPath(draftDirectory, safeName);
  } catch (error) {
    const message = error instanceof Error ? error.message : '目标路径超出允许目录范围。';
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  try {
    const buffer = await buildPdfBuffer(parsedBlocks.data);
    await fs.writeFile(fullPath, buffer);
    await appendMainLog('INFO', `create_pdf_draft success: ${fullPath}, blocks: ${parsedBlocks.data.length}`);
    return {
      ok: true,
      content: `已创建 PDF 草稿：${fullPath}（${parsedBlocks.data.length} 个内容块）`,
      data: { path: fullPath, blocks: parsedBlocks.data.length },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PDF 草稿创建失败。';
    await appendMainLog('ERROR', `create_pdf_draft failed: ${fullPath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: `PDF 草稿创建失败：${message}`
    };
  }
}

export async function updateExcelCells(
  filePath: string,
  sheetName: string,
  updates: ExcelCellUpdate[],
  outputFileName?: string,
  signal?: AbortSignal,
): Promise<ToolResult> {
  let resolvedPath: string;

  try {
    resolvedPath = await assertWithinAllowedPaths(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : '路径验证失败。';
    await appendMainLog('ERROR', `update_excel_cells path validation failed: ${filePath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  const extension = path.extname(resolvedPath).toLowerCase();

  if (!excelUpdatableExtensions.has(extension)) {
    return {
      ok: false,
      content: '',
      error: extension === '.xlsm'
        ? '含宏的 .xlsm 无法在保留宏的前提下修改，请另存为 .xlsx 后重试。'
        : extension === '.csv'
          ? 'CSV 请先用 read_excel 读出内容，再用 create_excel_draft 生成新文件。'
          : '仅支持修改 .xlsx 文件。',
      data: { path: resolvedPath },
    };
  }

  try {
    const stat = await fs.stat(resolvedPath);

    if (!stat.isFile()) {
      return { ok: false, content: '', error: '目标路径不是文件。', data: { path: resolvedPath } };
    }

    if (stat.size > maxExcelFileSizeBytes) {
      return {
        ok: false,
        content: '',
        error: `文件过大（${(stat.size / 1024 / 1024).toFixed(2)}MB），最大支持 ${maxExcelFileSizeBytes / 1024 / 1024}MB。`,
        data: { path: resolvedPath },
      };
    }

    signal?.throwIfAborted();
    const sourceBuffer = await fs.readFile(resolvedPath);
    const result = await applyExcelCellUpdates(sourceBuffer, sheetName, updates, signal);

    if (!result.ok) {
      await appendMainLog('ERROR', `update_excel_cells rejected: ${resolvedPath}, error: ${result.error}`);
      return { ok: false, content: '', error: result.error, data: { path: resolvedPath } };
    }

    const draftDirectory = await getDraftDirectory();

    const defaultName = `${path.basename(resolvedPath, extension)}-updated.xlsx`;
    const safeName = ensureXlsxExtension(sanitizeDraftRelativePath((outputFileName ?? '').trim() || defaultName));

    let outputPath: string;

    try {
      outputPath = resolveChildPath(draftDirectory, safeName);
    } catch (error) {
      const message = error instanceof Error ? error.message : '目标路径超出允许目录范围。';
      return { ok: false, content: '', error: message, data: { path: resolvedPath } };
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, result.buffer);

    const changeSummary = result.applied
      .map((change) => `${change.cell}: ${change.before || '(空)'} → ${change.after || '(空)'}`)
      .join('\n');

    await appendMainLog('INFO', `update_excel_cells success: ${resolvedPath} -> ${outputPath}, cells: ${result.applied.length}`);

    return {
      ok: true,
      content: `已在工作表「${result.sheetName}」修改 ${result.applied.length} 个单元格，结果另存为新文件（原文件未改动）：${outputPath}\n${changeSummary}`,
      data: {
        sourcePath: resolvedPath,
        path: outputPath,
        sheetName: result.sheetName,
        updatedCells: result.applied.length,
        changes: result.applied,
      },
    };
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message === '工具执行已取消。')) {
      throw new Error('工具执行已取消。');
    }

    const message = error instanceof Error ? error.message : 'Excel 修改失败。';
    await appendMainLog('ERROR', `update_excel_cells failed: ${resolvedPath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: `Excel 修改失败：${message}`,
      data: { path: resolvedPath },
    };
  }
}

/** 草稿文件列表的条数上限，避免超大目录把模型上下文撑爆。 */
const draftListMaxEntries = 500;

function formatDraftSize(size: number) {
  if (size < 1024) {
    return `${size}B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)}KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

/** 在草稿目录内移动/重命名文件（支持相对子目录，目标目录自动创建，目标已存在时拒绝）。 */
export async function moveDraftFile(fileName: string, newFileName: string): Promise<ToolResult> {
  const draftDirectory = await getDraftDirectory();

  const safeSource = sanitizeDraftRelativePath(fileName.trim());
  const safeTarget = sanitizeDraftRelativePath(newFileName.trim());

  if (!safeSource || !safeTarget) {
    return { ok: false, content: '', error: '源路径与目标路径都不能为空。' };
  }
  if (safeSource === safeTarget) {
    return { ok: false, content: '', error: '源路径与目标路径相同，无需移动。' };
  }

  let sourcePath: string;
  let targetPath: string;

  try {
    sourcePath = resolveChildPath(draftDirectory, safeSource);
    targetPath = resolveChildPath(draftDirectory, safeTarget);
  } catch (error) {
    const message = error instanceof Error ? error.message : '目标路径超出允许目录范围。';
    await appendMainLog('ERROR', `move_draft_file path rejected: ${fileName} -> ${newFileName}, error: ${message}`);
    return { ok: false, content: '', error: message };
  }

  try {
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile()) {
      return { ok: false, content: '', error: '源路径不是文件。' };
    }
    if (await pathExists(targetPath)) {
      return { ok: false, content: '', error: `目标文件已存在：${targetPath}。如需替换请先删除目标文件，或改用其它文件名。` };
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.rename(sourcePath, targetPath);
    await appendMainLog('INFO', `move_draft_file success: ${sourcePath} -> ${targetPath}`);

    return {
      ok: true,
      content: `已将「${path.basename(sourcePath)}」移动至：${targetPath}。如需向用户展示，请调用对应的 preview 工具并传入上述路径。`,
      data: { from: sourcePath, to: targetPath },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '文件移动失败。';
    await appendMainLog('ERROR', `move_draft_file failed: ${sourcePath} -> ${targetPath}, error: ${message}`);
    return { ok: false, content: '', error: message };
  }
}

type DraftListEntry = { path: string; kind: 'file' | 'directory'; size?: number };

/** 递归列出草稿目录（含相对子目录）中的文件与子目录，按路径排序，条数有上限。
 *  keyword 可按相对路径模糊筛选（大小写不敏感的包含匹配），兼作草稿目录内的名称搜索。 */
export async function listDraftFiles(subDirectory?: string, keyword?: string): Promise<ToolResult> {
  const draftDirectory = await getDraftDirectory();

  const safeSub = sanitizeDraftRelativePath((subDirectory ?? '').trim());
  const normalizedKeyword = (keyword ?? '').trim().toLowerCase();
  let rootPath: string;

  try {
    rootPath = safeSub ? resolveChildPath(draftDirectory, safeSub) : draftDirectory;
  } catch (error) {
    const message = error instanceof Error ? error.message : '目标路径超出允许目录范围。';
    return { ok: false, content: '', error: message };
  }

  const stat = await fs.stat(rootPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return {
      ok: false,
      content: '',
      error: safeSub ? `子目录不存在：${safeSub}` : '草稿目录不存在。',
    };
  }

  const entries: DraftListEntry[] = [];
  let truncated = false;

  const walk = async (dir: string): Promise<void> => {
    if (entries.length >= draftListMaxEntries) {
      truncated = true;
      return;
    }

    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (entries.length >= draftListMaxEntries) {
        truncated = true;
        return;
      }

      const itemPath = path.join(dir, item.name);
      const relativePath = path.relative(draftDirectory, itemPath).split(path.sep).join('/');

      // keyword 过滤在遍历时进行：条数上限作用于筛选后的结果
      if (normalizedKeyword && !relativePath.toLowerCase().includes(normalizedKeyword)) {
        continue;
      }

      if (item.isDirectory()) {
        entries.push({ path: relativePath, kind: 'directory' });
        await walk(itemPath);
      } else if (item.isFile()) {
        const fileStat = await fs.stat(itemPath).catch(() => null);
        entries.push({ path: relativePath, kind: 'file', size: fileStat?.size });
      }
    }
  };

  try {
    await walk(rootPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取草稿目录失败。';
    await appendMainLog('ERROR', `list_draft_files failed: ${rootPath}, error: ${message}`);
    return { ok: false, content: '', error: message };
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  const fileCount = entries.filter((entry) => entry.kind === 'file').length;
  const directoryCount = entries.length - fileCount;
  const lines = entries.map((entry) =>
    entry.kind === 'directory' ? `- ${entry.path}/` : `- ${entry.path}（${formatDraftSize(entry.size ?? 0)}）`,
  );

  if (truncated) {
    lines.push(`…[已达到 ${draftListMaxEntries} 条上限，其余条目省略]`);
  }

  return {
    ok: true,
    content: [
      `草稿目录${safeSub ? ` ${safeSub}/` : ''}${normalizedKeyword ? ` 中匹配「${normalizedKeyword}」的` : ''} 共 ${entries.length} 项（文件 ${fileCount}、子目录 ${directoryCount}）${truncated ? '（已截断）' : ''}：`,
      ...lines,
    ].join('\n'),
    data: { root: rootPath, subDirectory: safeSub || undefined, keyword: normalizedKeyword || undefined, count: entries.length, fileCount, directoryCount, truncated, entries },
  };
}



export async function httpRequest(
  url: string,
  query?: HttpRequestQuery,
  headers?: HttpRequestHeaders,
  signal?: AbortSignal,
): Promise<ToolResult> {
  let targetUrl: URL;

  try {
    targetUrl = new URL(url);
  } catch {
    return {
      ok: false,
      content: '',
      error: '请求地址不是合法 URL。',
    };
  }

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return {
      ok: false,
      content: '',
      error: '仅支持 http 或 https 协议。',
    };
  }

  for (const [key, value] of Object.entries(query ?? {})) {
    const normalizedKey = key.trim();

    if (!normalizedKey) {
      continue;
    }

    targetUrl.searchParams.set(normalizedKey, value);
  }

  const requestHeaders = sanitizeRequestHeaders(headers);
  const requestHeaderSummary = summarizeRequestHeaders(requestHeaders);
  const finalUrl = targetUrl.toString();

  let response: Response;

  try {
    response = await fetch(targetUrl, {
      method: 'GET',
      headers: requestHeaders,
      signal,
      redirect: 'follow',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('工具执行已取消。');
    }

    const message = error instanceof Error ? error.message : '未知网络错误。';
    await appendMainLog(
      'ERROR',
      `http request failed: url=${finalUrl}, headers=${JSON.stringify(requestHeaderSummary)}, error=${message}`,
    );
    return {
      ok: false,
      content: '',
      error: `网络请求失败：${message}`,
      data: {
        url: finalUrl,
        requestHeaders: requestHeaderSummary,
      },
    };
  }

  const contentType = response.headers.get('content-type') ?? '';
  const responseHeaders = summarizeResponseHeaders(response.headers);
  const rawText = await response.text();
  const { text: bodyPreview, truncated } = truncateText(rawText, textResponsePreviewLimit);
  const content = buildHttpRequestContent(finalUrl, response, contentType, bodyPreview, truncated);

  return {
    ok: response.ok,
    content,
    error: response.ok ? undefined : `请求返回非成功状态：${response.status}`,
    data: {
      url: finalUrl,
      status: response.status,
      statusText: response.statusText,
      contentType,
      requestHeaders: requestHeaderSummary,
      responseHeaders,
      bodyPreview,
      truncated,
    },
  };
}

export async function extractPdfText(filePath: string, signal?: AbortSignal): Promise<ToolResult> {
  let resolvedPath: string;

  try {
    resolvedPath = await assertWithinAllowedPaths(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : '路径验证失败。';
    await appendMainLog('ERROR', `extract_pdf_text path validation failed: ${filePath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  if (path.extname(resolvedPath).toLowerCase() !== '.pdf') {
    return {
      ok: false,
      content: '',
      error: '目标文件不是 PDF。',
    };
  }

  try {
    signal?.throwIfAborted();
    const pdfBuffer = await fs.readFile(resolvedPath);
    const pdfParseModule = await import('pdf-parse');
    const parser = new pdfParseModule.PDFParse({ data: pdfBuffer });

    try {
      const textResult = await parser.getText();
      const rawText = textResult.text.trim();
      if (!rawText) {
        return {
          ok: false,
          content: '',
          error: 'PDF 中没有可提取的文本内容，可能是扫描件或图片型 PDF。',
          data: {
            path: resolvedPath,
            extractor: 'pdf-parse',
          },
        };
      }

      const preview = truncateText(rawText, maxPdfExtractPreviewLength);
      return {
        ok: true,
        content: preview.text,
        data: {
          path: resolvedPath,
          extractor: 'pdf-parse',
          truncated: preview.truncated,
          totalPages: textResult.pages.length,
        },
      };
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('工具执行已取消。');
    }

    const message = error instanceof Error ? error.message : 'PDF 文本提取失败。';
    await appendMainLog('ERROR', `extract_pdf_text failed: ${resolvedPath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: `PDF 文本提取失败：${message}`,
      data: {
        path: resolvedPath,
        extractor: 'pdf-parse',
      },
    };
  }
}

const maxWordExtractPreviewLength = 12000;

export async function extractWordText(filePath: string, signal?: AbortSignal): Promise<ToolResult> {
  let resolvedPath: string;

  try {
    resolvedPath = await assertWithinAllowedPaths(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : '路径验证失败。';
    await appendMainLog('ERROR', `extract_word_text path validation failed: ${filePath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  if (extension !== '.docx') {
    return {
      ok: false,
      content: '',
      error: extension === '.doc'
        ? '旧版 .doc（二进制 Word）暂不支持，请转换为 .docx 或 PDF 后重试。'
        : '目标文件不是 .docx。',
      data: { path: resolvedPath },
    };
  }

  try {
    signal?.throwIfAborted();
    const buffer = await fs.readFile(resolvedPath);
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const rawText = (result?.value ?? '').trim();

    if (!rawText) {
      return {
        ok: false,
        content: '',
        error: 'Word 文档中没有可提取的文本内容，可能是空文档或纯图片文档。',
        data: { path: resolvedPath, extractor: 'mammoth' },
      };
    }

    const preview = truncateText(rawText, maxWordExtractPreviewLength);
    return {
      ok: true,
      content: preview.text,
      data: {
        path: resolvedPath,
        extractor: 'mammoth',
        truncated: preview.truncated,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('工具执行已取消。');
    }

    const message = error instanceof Error ? error.message : 'Word 文本提取失败。';
    await appendMainLog('ERROR', `extract_word_text failed: ${resolvedPath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: `Word 文本提取失败：${message}`,
      data: { path: resolvedPath, extractor: 'mammoth' },
    };
  }
}

const maxPptExtractPreviewLength = 12000;
const pptSlidePathPattern = /^ppt\/slides\/slide(\d+)\.xml$/i;

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractSlideText(xml: string) {
  const parts: string[] = [];
  const pattern = /<a:t[^>]*>([\s\S]*?)<\/a:t>/gi;
  let match = pattern.exec(xml);
  while (match) {
    parts.push(decodeXmlEntities(match[1]));
    match = pattern.exec(xml);
  }
  return parts.join('');
}

export async function extractPptText(filePath: string, signal?: AbortSignal): Promise<ToolResult> {
  let resolvedPath: string;

  try {
    resolvedPath = await assertWithinAllowedPaths(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : '路径验证失败。';
    await appendMainLog('ERROR', `extract_ppt_text path validation failed: ${filePath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  if (extension !== '.pptx') {
    return {
      ok: false,
      content: '',
      error: extension === '.ppt'
        ? '旧版 .ppt（二进制 PowerPoint）暂不支持，请转换为 .pptx 或 PDF 后重试。'
        : '目标文件不是 .pptx。',
      data: { path: resolvedPath },
    };
  }

  try {
    signal?.throwIfAborted();
    const buffer = await fs.readFile(resolvedPath);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);

    const slidePaths = Object.keys(zip.files)
      .filter((entryPath) => pptSlidePathPattern.test(entryPath))
      .sort((a, b) => {
        const numA = Number(pptSlidePathPattern.exec(a)?.[1] ?? 0);
        const numB = Number(pptSlidePathPattern.exec(b)?.[1] ?? 0);
        return numA - numB;
      });

    if (slidePaths.length === 0) {
      return {
        ok: false,
        content: '',
        error: 'PPT 中没有可提取的幻灯片文本，可能是空文档或纯图片文档。',
        data: { path: resolvedPath, extractor: 'jszip' },
      };
    }

    const slides: string[] = [];
    for (const slidePath of slidePaths) {
      const xml = await zip.file(slidePath)!.async('string');
      const text = extractSlideText(xml).trim();
      const slideNumber = Number(pptSlidePathPattern.exec(slidePath)?.[1] ?? slides.length + 1);
      slides.push(`--- 第 ${slideNumber} 页 ---\n${text || '[本页无可提取文本]'}`);
    }

    const rawText = slides.join('\n\n');
    const preview = truncateText(rawText, maxPptExtractPreviewLength);
    return {
      ok: true,
      content: preview.text,
      data: {
        path: resolvedPath,
        extractor: 'jszip',
        truncated: preview.truncated,
        slideCount: slidePaths.length,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('工具执行已取消。');
    }

    const message = error instanceof Error ? error.message : 'PPT 文本提取失败。';
    await appendMainLog('ERROR', `extract_ppt_text failed: ${resolvedPath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: `PPT 文本提取失败：${message}`,
      data: { path: resolvedPath, extractor: 'jszip' },
    };
  }
}

export async function extractExcelText(
  filePath: string,
  options?: ExcelExtractOptions,
  signal?: AbortSignal,
): Promise<ToolResult> {
  let resolvedPath: string;

  try {
    resolvedPath = await assertWithinAllowedPaths(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : '路径验证失败。';
    await appendMainLog('ERROR', `read_excel path validation failed: ${filePath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: message,
    };
  }

  const extension = path.extname(resolvedPath).toLowerCase();

  if (!excelReadableExtensions.has(extension)) {
    return {
      ok: false,
      content: '',
      error: extension === '.xls'
        ? '旧版 .xls（二进制 Excel）暂不支持，请转换为 .xlsx 或 CSV 后重试。'
        : '目标文件不是 .xlsx / .xlsm / .csv。',
      data: { path: resolvedPath },
    };
  }

  try {
    const stat = await fs.stat(resolvedPath);

    if (!stat.isFile()) {
      return { ok: false, content: '', error: '目标路径不是文件。', data: { path: resolvedPath } };
    }

    if (stat.size > maxExcelFileSizeBytes) {
      return {
        ok: false,
        content: '',
        error: `文件过大（${(stat.size / 1024 / 1024).toFixed(2)}MB），最大支持 ${maxExcelFileSizeBytes / 1024 / 1024}MB。`,
        data: { path: resolvedPath },
      };
    }

    signal?.throwIfAborted();
    const buffer = await fs.readFile(resolvedPath);
    signal?.throwIfAborted();

    const result = extension === '.csv'
      ? readCsvBuffer(buffer, options)
      : await readXlsxBuffer(buffer, options, signal);

    if (result.ok) {
      await appendMainLog('INFO', `read_excel success: ${resolvedPath}, ${JSON.stringify(result.data)}`);
    } else {
      await appendMainLog('ERROR', `read_excel failed: ${resolvedPath}, error: ${result.error ?? '未知错误'}`);
    }

    return {
      ...result,
      data: { path: resolvedPath, ...(result.data as Record<string, unknown> | undefined) },
    };
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message === '工具执行已取消。')) {
      throw new Error('工具执行已取消。');
    }

    const message = error instanceof Error ? error.message : 'Excel 读取失败。';
    await appendMainLog('ERROR', `read_excel failed: ${resolvedPath}, error: ${message}`);
    return {
      ok: false,
      content: '',
      error: `Excel 读取失败：${message}`,
      data: { path: resolvedPath },
    };
  }
}

function getCommandRuntime() {
  if (process.platform === 'win32') {
    return {
      executable: 'powershell.exe',
      args: ['-NoProfile', '-Command'] as string[],
      label: 'PowerShell',
    };
  }

  if (process.platform === 'darwin') {
    return {
      executable: '/bin/zsh',
      args: ['-lc'] as string[],
      label: 'zsh',
    };
  }

  return {
    executable: process.env.SHELL || '/bin/bash',
    args: ['-lc'] as string[],
    label: path.basename(process.env.SHELL || '/bin/bash'),
  };
}

export function getCommandRuntimeLabel(): string {
  if (process.platform === 'win32') {
    return 'PowerShell';
  }
  if (process.platform === 'darwin') {
    return 'zsh';
  }
  return path.basename(process.env.SHELL || '/bin/bash');
}

export function getCommandToolDescription() {
  const timeoutHint = `单次执行最长 ${Math.round(commandToolTimeoutMs / 1000)} 秒，超时会被强制终止并只返回终止前的输出，因此批量任务请自行拆批。`;
  const allowlistHint = '内置只读命令（如 ls、cat、git status、Get-Process）与用户白名单内的命令会自动执行，其余命令执行前需要用户确认，用户可在弹窗中勾选"总是允许此命令"。';
  const readonlyHint = '注意：遍历目录、按名查找文件、搜索文件内容、分页读取大文件、统计关键字命中数等只读操作，请优先用专用工具（list_dir、glob_files、grep_files、read_file、count_matches），它们无需审批且更稳定，不要为这些操作调用本命令工具。下载文件落盘请用 download_file，解压 .zip 请用 extract_archive，不要用 Invoke-WebRequest / curl / Expand-Archive。';

  if (process.platform === 'win32') {
    return `执行任意 Windows PowerShell 命令。高风险操作。${readonlyHint}${allowlistHint}${timeoutHint}`;
  }
  if (process.platform === 'darwin') {
    return `执行任意 macOS zsh 命令。高风险操作。${readonlyHint}${allowlistHint}${timeoutHint}`;
  }
  return `执行任意 Linux/Unix shell 命令。高风险操作。${readonlyHint}${allowlistHint}${timeoutHint}`;
}

async function executeSystemCommand(
  command: string,
  signal: AbortSignal | undefined,
  successMessage: string,
  errorPrefix: string,
  data: Record<string, unknown>,
): Promise<ToolResult> {
  const runtime = getCommandRuntime();

  return new Promise<ToolResult>((resolve, reject) => {
    const child = spawn(runtime.executable, [...runtime.args, command], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 强制 Python 以 UTF-8 输出：Windows 控制台默认 GBK，会导致输出乱码，
      // 打印 GBK 以外字符时还可能抛 UnicodeEncodeError 退出
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });

    let stdout = '';
    let stderr = '';

    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort);
    };

    const handleAbort = () => {
      child.kill();
      cleanup();

      // 超时的场景把已产生的输出带回去，否则模型无从判断进度，只能从头重跑。
      if (!isTimeoutAbort(signal)) {
        reject(new Error('工具执行已取消。'));
        return;
      }

      const stdoutPreview = truncateText(stdout.trim(), commandOutputPreviewLimit);
      const stderrPreview = truncateText(stderr.trim(), commandOutputPreviewLimit);

      resolve({
        ok: false,
        content: '',
        error: [
          `${errorPrefix}：执行超过 ${Math.round(commandToolTimeoutMs / 1000)} 秒已被强制终止，命令可能只完成了一部分。`,
          `终止前的标准输出：\n${stdoutPreview.text || '[无输出]'}`,
          stderrPreview.text ? `终止前的错误输出：\n${stderrPreview.text}` : '',
          '请先核对实际完成情况（例如列出目标目录），再决定是否拆成更小的批次继续。',
        ].filter(Boolean).join('\n\n'),
        data: {
          ...data,
          shell: runtime.label,
          executable: runtime.executable,
          timedOut: true,
          timeoutMs: commandToolTimeoutMs,
          partialStdout: stdoutPreview.text,
          partialStderr: stderrPreview.text,
        },
      });
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });

    child.on('close', (code) => {
      cleanup();

      const stdoutPreview = truncateText(stdout.trim(), commandOutputPreviewLimit);
      const stderrPreview = truncateText(stderr.trim(), commandOutputPreviewLimit);

      if (code === 0) {
        resolve({
          ok: true,
          content: stdoutPreview.text || successMessage,
          data: {
            ...data,
            shell: runtime.label,
            executable: runtime.executable,
            truncated: stdoutPreview.truncated,
          },
        });
        return;
      }

      resolve({
        ok: false,
        content: '',
        error: stderrPreview.text || `${errorPrefix}，退出码 ${code}`,
        data: {
          ...data,
          shell: runtime.label,
          executable: runtime.executable,
          truncated: stderrPreview.truncated,
        },
      });
    });
  });
}

export async function runCommand(command: string, signal?: AbortSignal): Promise<ToolResult> {
  return executeSystemCommand(command, signal, '命令执行完成。', '命令执行失败', { command });
}

export async function runPowershellTemplate(
  templateName: (typeof availablePowershellTemplates)[number],
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      content: '',
      error: 'PowerShell 模板仅支持 Windows 系统。当前系统请使用 run_command 执行对应 shell 命令。',
      data: { templateName, platform: process.platform },
    };
  }

  const command = powershellTemplates[templateName];
  return executeSystemCommand(command, signal, 'PowerShell 模板执行完成。', 'PowerShell 执行失败', { templateName });
}
