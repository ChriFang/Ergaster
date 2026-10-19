import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { ToolResult } from '../../shared/tools';
import {
  compileSearchPattern,
  createIgnoreMatcher,
  defaultIgnoredDirectories,
  defaultReadLines,
  formatNumberedLines,
  looksBinary,
  matchGlob,
  maxCodeFileBytes,
  maxGlobResults,
  maxGrepResults,
  maxReadLines,
  maxWalkEntries,
  parseIgnorePatterns,
  resolveProjectPath,
  toProjectRelativePath,
  type FileScope,
} from './code-tools-utils';

/**
 * 文件遍历/检索/读取引擎（零 Electron 依赖，可被 node --test 直接打包）。
 * 引擎只认 FileScope（沙箱边界抽象），Code 模式与通用模式各自提供不同的 scope 实现，共用这一套逻辑。
 * 单文件体积上限通过 maxFileBytes 选项注入：代码场景沿用 maxCodeFileBytes（10MB），
 * 日志等通用场景传更大的上限（见 maxTextScanFileBytes）。
 */

/** 超过该体积改用流式按行读取，避免把整文件读进内存。 */
const streamReadThresholdBytes = 4 * 1024 * 1024;
/** 读取首部用于二进制判定的字节数。 */
const binarySniffBytes = 8000;

type WalkEntry = {
  absolutePath: string;
  relativePath: string;
  isDirectory: boolean;
};

type WalkOptions = {
  /** 遍历起点的绝对路径，必须已经通过 scope.resolve 校验。 */
  startPath: string;
  recursive: boolean;
  signal: AbortSignal;
  /** 最多产出多少条目，超出后停止遍历并置 truncated。 */
  limit: number;
};

type WalkResult = {
  entries: WalkEntry[];
  truncated: boolean;
  visited: number;
};

/** 读取记录回调：读文件时上报新鲜度信息，供写入链路做"读过才可写"校验。 */
export type RecordReadFn = (absolutePath: string, record: { mtimeMs: number; size: number; fullyRead: boolean }) => void;

export function toErrorResult(error: unknown, fallback: string): ToolResult {
  const message = error instanceof Error ? error.message : fallback;
  return { ok: false, content: '', error: message };
}

/**
 * 构造 Code 模式的文件沙箱：工程根 + 根级 .gitignore + 默认排除目录。
 */
export function createProjectScope(projectRoot: string): FileScope {
  const normalizedRoot = path.resolve(projectRoot);
  let ignoreMatcherPromise: Promise<(relativePath: string, isDirectory: boolean) => boolean> | null = null;

  return {
    async resolve(input: string) {
      return resolveProjectPath(normalizedRoot, input);
    },
    relativize(absolutePath: string) {
      return toProjectRelativePath(normalizedRoot, absolutePath);
    },
    getIgnoreMatcher() {
      if (!ignoreMatcherPromise) {
        ignoreMatcherPromise = loadProjectIgnoreMatcher(normalizedRoot);
      }
      return ignoreMatcherPromise;
    },
  };
}

/**
 * 载入工程根的 .gitignore（只读根级文件，嵌套 .gitignore 暂不支持），
 * 与默认排除目录合并成一个忽略判定函数。
 */
async function loadProjectIgnoreMatcher(projectRoot: string) {
  const rules = defaultIgnoredDirectories.map((name) => ({
    pattern: name,
    negated: false,
    directoryOnly: false,
    anchored: false,
  }));

  try {
    const raw = await fs.readFile(path.join(projectRoot, '.gitignore'), 'utf8');
    rules.push(...parseIgnorePatterns(raw));
  } catch {
    // 没有 .gitignore 或读不到时只用默认排除规则
  }

  return createIgnoreMatcher(rules);
}

/**
 * 深度优先遍历目录。跳过符号链接（避免绕过沙箱边界）与被忽略的路径，
 * 并对访问节点数设上限，防止超大目录阻塞主进程。
 */
export async function walkScope(scope: FileScope, options: WalkOptions): Promise<WalkResult> {
  const isIgnored = await scope.getIgnoreMatcher();
  const entries: WalkEntry[] = [];
  const stack: string[] = [options.startPath];
  let visited = 0;
  let truncated = false;

  while (stack.length > 0) {
    options.signal.throwIfAborted();

    const currentDir = stack.pop() as string;
    let dirEntries;
    try {
      dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirEntry of dirEntries) {
      visited += 1;
      if (visited > maxWalkEntries) {
        return { entries, truncated: true, visited };
      }

      if (dirEntry.isSymbolicLink()) {
        continue;
      }

      const absolutePath = path.join(currentDir, dirEntry.name);
      const relativePath = scope.relativize(absolutePath);
      const isDirectory = dirEntry.isDirectory();

      if (isIgnored(relativePath, isDirectory)) {
        continue;
      }

      if (!isDirectory && !dirEntry.isFile()) {
        continue;
      }

      entries.push({ absolutePath, relativePath, isDirectory });
      if (entries.length >= options.limit) {
        truncated = true;
        return { entries, truncated, visited };
      }

      if (isDirectory && options.recursive) {
        stack.push(absolutePath);
      }
    }
  }

  return { entries, truncated, visited };
}

/** 遍历并统计文件数（受默认排除规则与上限约束）。 */
export async function countFilesInScope(scope: FileScope, startPath: string, limit: number, signal: AbortSignal) {
  const result = await walkScope(scope, { startPath, recursive: true, signal, limit });
  return {
    fileCount: result.entries.filter((entry) => !entry.isDirectory).length,
    truncated: result.truncated,
  };
}

/** 列目录引擎：按 scope 约束遍历并格式化输出。 */
export async function listDirInScope(
  scope: FileScope,
  args: { dirPath?: string; recursive?: boolean; limit?: number },
  signal: AbortSignal,
): Promise<ToolResult> {
  try {
    const startPath = await scope.resolve(args.dirPath ?? '.');
    const stat = await fs.stat(startPath);
    if (!stat.isDirectory()) {
      return { ok: false, content: '', error: `不是目录：${scope.relativize(startPath) || '.'}` };
    }

    const limit = Math.min(Math.max(args.limit ?? 200, 1), 1000);
    const { entries, truncated } = await walkScope(scope, {
      startPath,
      recursive: args.recursive ?? false,
      signal,
      limit,
    });

    const sorted = [...entries].sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? -1 : 1;
      }
      return left.relativePath.localeCompare(right.relativePath);
    });

    const lines = await Promise.all(sorted.map(async (entry) => {
      if (entry.isDirectory) {
        return `d  ${entry.relativePath}/`;
      }
      try {
        const fileStat = await fs.stat(entry.absolutePath);
        return `f  ${entry.relativePath}  (${fileStat.size} bytes)`;
      } catch {
        return `f  ${entry.relativePath}`;
      }
    }));

    const header = `目录：${scope.relativize(startPath) || '.'}（共 ${sorted.length} 项${truncated ? `，已截断到 ${limit} 项` : ''}）`;
    return { ok: true, content: sorted.length > 0 ? `${header}\n${lines.join('\n')}` : `${header}\n(空目录)` };
  } catch (error) {
    return toErrorResult(error, '列出目录失败。');
  }
}

/** 读取文件首部若干字节做二进制判定，避免把超大文件整体读进内存。 */
async function fileLooksBinary(absolutePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(absolutePath, 'r');
    const buffer = Buffer.alloc(binarySniffBytes);
    const { bytesRead } = await handle.read(buffer, 0, binarySniffBytes, 0);
    return looksBinary(buffer.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/** 分页读取引擎：按 scope 校验路径、按行分页返回。recordRead 回调用于写入链路的新鲜度追踪。 */
export async function readFileInScope(
  scope: FileScope,
  args: { filePath: string; startLine?: number; maxLines?: number },
  signal: AbortSignal,
  options?: { recordRead?: RecordReadFn; maxFileBytes?: number },
): Promise<ToolResult> {
  try {
    const targetPath = await scope.resolve(args.filePath);
    const stat = await fs.stat(targetPath);
    if (!stat.isFile()) {
      return { ok: false, content: '', error: `不是文件：${scope.relativize(targetPath)}` };
    }
    const maxFileBytes = options?.maxFileBytes ?? maxCodeFileBytes;
    if (stat.size > maxFileBytes) {
      return { ok: false, content: '', error: `文件超过 ${Math.floor(maxFileBytes / 1024 / 1024)}MB，无法读取。` };
    }

    signal.throwIfAborted();

    const startLine = Math.max(args.startLine ?? 1, 1);
    const maxLines = Math.min(Math.max(args.maxLines ?? defaultReadLines, 1), maxReadLines);

    // 大文件走流式按行读取，只在内存里保留目标窗口，避免整文件进内存
    const read = stat.size > streamReadThresholdBytes
      ? await readLinesStreaming(targetPath, startLine, maxLines, signal)
      : await readLinesInMemory(targetPath, startLine, maxLines);

    if (read.binary) {
      return { ok: false, content: '', error: '目标文件疑似二进制，无法按文本读取。' };
    }

    const effectiveStart = read.totalLines === 0 ? 1 : Math.min(startLine, read.totalLines);
    const hasMore = effectiveStart + read.selected.length <= read.totalLines;
    const nextStartLine = effectiveStart + read.selected.length;

    options?.recordRead?.(targetPath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      fullyRead: effectiveStart === 1 && !hasMore,
    });

    const header = [
      `文件：${scope.relativize(targetPath)}`,
      `行范围：${effectiveStart}-${effectiveStart + Math.max(read.selected.length - 1, 0)} / 共 ${read.totalLines} 行`,
      hasMore ? `未读完，可用 startLine=${nextStartLine} 继续读取。` : '已读到文件末尾。',
    ].join('\n');

    return { ok: true, content: `${header}\n\n${formatNumberedLines(read.selected, effectiveStart)}` };
  } catch (error) {
    return toErrorResult(error, '读取文件失败。');
  }
}

type ReadLinesResult = { selected: string[]; totalLines: number; binary: boolean };

/** 小文件：整体读入后按行切片。 */
async function readLinesInMemory(targetPath: string, startLine: number, maxLines: number): Promise<ReadLinesResult> {
  const buffer = await fs.readFile(targetPath);
  if (looksBinary(buffer)) {
    return { selected: [], totalLines: 0, binary: true };
  }
  const allLines = buffer.toString('utf8').split(/\r?\n/);
  const clampedStart = Math.min(startLine, Math.max(allLines.length, 1));
  const selected = allLines.slice(clampedStart - 1, clampedStart - 1 + maxLines);
  return { selected, totalLines: allLines.length, binary: false };
}

/** 大文件：流式逐行扫描，只缓冲目标窗口 [startLine, startLine+maxLines)，其余行只计数。 */
async function readLinesStreaming(
  targetPath: string,
  startLine: number,
  maxLines: number,
  signal: AbortSignal,
): Promise<ReadLinesResult> {
  if (await fileLooksBinary(targetPath)) {
    return { selected: [], totalLines: 0, binary: true };
  }

  const stream = createReadStream(targetPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const selected: string[] = [];
  let totalLines = 0;
  const windowEnd = startLine + maxLines;

  try {
    for await (const line of rl) {
      signal.throwIfAborted();
      totalLines += 1;
      if (totalLines >= startLine && totalLines < windowEnd) {
        selected.push(line);
      }
    }
  } finally {
    rl.close();
    stream.close();
  }

  return { selected, totalLines, binary: false };
}

/** glob 检索引擎：递归遍历后按文件名/相对路径匹配。 */
export async function globInScope(
  scope: FileScope,
  args: { pattern: string; dirPath?: string; limit?: number },
  signal: AbortSignal,
): Promise<ToolResult> {
  try {
    const startPath = await scope.resolve(args.dirPath ?? '.');
    const limit = Math.min(Math.max(args.limit ?? 100, 1), maxGlobResults);
    const pattern = args.pattern.trim();
    if (!pattern) {
      return { ok: false, content: '', error: 'pattern 不能为空。' };
    }

    const { entries, truncated } = await walkScope(scope, {
      startPath,
      recursive: true,
      signal,
      limit: maxWalkEntries,
    });

    // 不含 "/" 的模式按文件名匹配，含 "/" 的模式按相对路径匹配
    const matchesByName = !pattern.includes('/');
    const matched = entries
      .filter((entry) => !entry.isDirectory)
      .filter((entry) => matchGlob(pattern, matchesByName ? (entry.relativePath.split('/').pop() ?? '') : entry.relativePath))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    const limited = matched.slice(0, limit);
    // 带上文件大小，便于模型一步完成"按名过滤 + 看大小"，无需回退命令行
    const lines = await Promise.all(limited.map(async (entry) => {
      try {
        const stat = await fs.stat(entry.absolutePath);
        return `${entry.relativePath}  (${stat.size} bytes)`;
      } catch {
        return entry.relativePath;
      }
    }));

    const header = `模式：${pattern}（命中 ${matched.length} 个文件${limited.length < matched.length ? `，仅显示前 ${limited.length} 个` : ''}${truncated ? '；目录过大，遍历已截断' : ''}）`;

    return { ok: true, content: lines.length > 0 ? `${header}\n${lines.join('\n')}` : `${header}\n(无匹配文件)` };
  } catch (error) {
    return toErrorResult(error, '按文件名检索失败。');
  }
}

export type GrepArgs = {
  pattern: string;
  dirPath?: string;
  include?: string[];
  exclude?: string[];
  contextLines?: number;
  caseInsensitive?: boolean;
  maxResults?: number;
};

/** 按 include/exclude glob 过滤候选文件（命中文件名或相对路径）。 */
function filterCandidatesByGlob(entries: WalkEntry[], include: string[], exclude: string[]): WalkEntry[] {
  return entries.filter((entry) => {
    if (entry.isDirectory) {
      return false;
    }
    const fileName = entry.relativePath.split('/').pop() ?? '';
    if (include.length > 0 && !include.some((pattern) => matchGlob(pattern, pattern.includes('/') ? entry.relativePath : fileName))) {
      return false;
    }
    return !exclude.some((pattern) => matchGlob(pattern, pattern.includes('/') ? entry.relativePath : fileName));
  });
}

/** 内容检索引擎：遍历候选文件、逐行正则匹配并带上下文。 */
export async function grepInScope(
  scope: FileScope,
  args: GrepArgs,
  signal: AbortSignal,
  options?: { maxFileBytes?: number },
): Promise<ToolResult> {
  try {
    const startPath = await scope.resolve(args.dirPath ?? '.');
    const regExp = compileSearchPattern(args.pattern, args.caseInsensitive ?? false);
    const maxResults = Math.min(Math.max(args.maxResults ?? 50, 1), maxGrepResults);
    const contextLines = Math.min(Math.max(args.contextLines ?? 2, 0), 10);
    const maxFileBytes = options?.maxFileBytes ?? maxCodeFileBytes;
    const include = (args.include ?? []).map((item) => item.trim()).filter(Boolean);
    const exclude = (args.exclude ?? []).map((item) => item.trim()).filter(Boolean);

    const { entries, truncated: walkTruncated } = await walkScope(scope, {
      startPath,
      recursive: true,
      signal,
      limit: maxWalkEntries,
    });

    const candidates = filterCandidatesByGlob(entries, include, exclude);

    const blocks: string[] = [];
    let matchCount = 0;
    let searchedFiles = 0;
    let resultTruncated = false;
    const oversized: string[] = [];

    for (const entry of candidates) {
      signal.throwIfAborted();
      if (matchCount >= maxResults) {
        resultTruncated = true;
        break;
      }

      let buffer: Buffer;
      try {
        const stat = await fs.stat(entry.absolutePath);
        if (stat.size > maxFileBytes) {
          // 超过上限的文件记录下来并在结尾提示，不再静默跳过
          oversized.push(entry.relativePath);
          continue;
        }
        buffer = await fs.readFile(entry.absolutePath);
      } catch {
        continue;
      }

      if (looksBinary(buffer)) {
        continue;
      }

      searchedFiles += 1;
      const lines = buffer.toString('utf8').split(/\r?\n/);

      for (let index = 0; index < lines.length; index += 1) {
        if (!regExp.test(lines[index])) {
          continue;
        }

        if (matchCount >= maxResults) {
          resultTruncated = true;
          break;
        }

        matchCount += 1;
        const from = Math.max(index - contextLines, 0);
        const to = Math.min(index + contextLines, lines.length - 1);
        const snippet = formatNumberedLines(lines.slice(from, to + 1), from + 1);
        blocks.push(`${entry.relativePath}:${index + 1}\n${snippet}`);
      }
    }

    const header = [
      `正则：${args.pattern}`,
      `命中 ${matchCount} 处，扫描 ${searchedFiles} 个文件`,
      resultTruncated ? `已达到结果上限（${maxResults}），请收窄检索范围。` : '',
      walkTruncated ? '目录过大，遍历已截断。' : '',
      formatOversizedHint(oversized, maxFileBytes),
    ].filter(Boolean).join('\n');

    return { ok: true, content: blocks.length > 0 ? `${header}\n\n${blocks.join('\n\n')}` : `${header}\n\n(无匹配内容)` };
  } catch (error) {
    return toErrorResult(error, '内容检索失败。');
  }
}

/** 构造"因超过体积上限被跳过"的提示，引导模型改用 read_file 分页读取这些大文件。 */
function formatOversizedHint(oversized: string[], maxFileBytes: number): string {
  if (oversized.length === 0) {
    return '';
  }
  const limitMb = Math.floor(maxFileBytes / 1024 / 1024);
  const shown = oversized.slice(0, 10);
  const more = oversized.length > shown.length ? `等 ${oversized.length} 个` : `${oversized.length} 个`;
  return `注意：有 ${more}文件超过 ${limitMb}MB 被跳过，未参与检索（如需在其中查找，请用 read_file 分页读取）：\n${shown.join('\n')}`;
}

export type CountMatchesArgs = {
  pattern: string;
  dirPath?: string;
  include?: string[];
  exclude?: string[];
  caseInsensitive?: boolean;
};

/**
 * 跨文件统计正则命中数（按文件分组），不返回每行内容。
 * 对应 PowerShell 的 `Select-String | Measure-Object` / `Group-Object` 聚合。
 */
export async function countMatchesInScope(
  scope: FileScope,
  args: CountMatchesArgs,
  signal: AbortSignal,
  options?: { maxFileBytes?: number },
): Promise<ToolResult> {
  try {
    const startPath = await scope.resolve(args.dirPath ?? '.');
    const regExp = compileSearchPattern(args.pattern, args.caseInsensitive ?? false);
    const maxFileBytes = options?.maxFileBytes ?? maxCodeFileBytes;
    const include = (args.include ?? []).map((item) => item.trim()).filter(Boolean);
    const exclude = (args.exclude ?? []).map((item) => item.trim()).filter(Boolean);

    const { entries, truncated: walkTruncated } = await walkScope(scope, {
      startPath,
      recursive: true,
      signal,
      limit: maxWalkEntries,
    });

    const candidates = filterCandidatesByGlob(entries, include, exclude);

    const perFile: { path: string; count: number }[] = [];
    let totalMatches = 0;
    let searchedFiles = 0;
    const oversized: string[] = [];

    for (const entry of candidates) {
      signal.throwIfAborted();

      let buffer: Buffer;
      try {
        const stat = await fs.stat(entry.absolutePath);
        if (stat.size > maxFileBytes) {
          oversized.push(entry.relativePath);
          continue;
        }
        buffer = await fs.readFile(entry.absolutePath);
      } catch {
        continue;
      }

      if (looksBinary(buffer)) {
        continue;
      }

      searchedFiles += 1;
      const lines = buffer.toString('utf8').split(/\r?\n/);
      let fileCount = 0;
      for (const line of lines) {
        if (regExp.test(line)) {
          fileCount += 1;
        }
      }
      if (fileCount > 0) {
        perFile.push({ path: entry.relativePath, count: fileCount });
        totalMatches += fileCount;
      }
    }

    perFile.sort((left, right) => right.count - left.count || left.path.localeCompare(right.path));

    const header = [
      `正则：${args.pattern}`,
      `总命中 ${totalMatches} 行，分布在 ${perFile.length} 个文件（共扫描 ${searchedFiles} 个文件）`,
      walkTruncated ? '目录过大，遍历已截断。' : '',
      formatOversizedHint(oversized, maxFileBytes),
    ].filter(Boolean).join('\n');

    const body = perFile.length > 0
      ? perFile.map((item) => `${item.count}\t${item.path}`).join('\n')
      : '(无匹配内容)';

    return { ok: true, content: `${header}\n\n${body}` };
  } catch (error) {
    return toErrorResult(error, '统计匹配失败。');
  }
}
