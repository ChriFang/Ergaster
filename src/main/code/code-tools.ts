import fs from 'node:fs/promises';
import path from 'node:path';
import { getAppDataRoot } from '../core/app-paths';
import { appendMainLog } from '../core/audit-log';
import { buildDiffStats, buildUnifiedDiff } from './code-diff';
import type { ToolResult } from '../../shared/tools';
import {
  applyLineEnding,
  detectDominantLineEnding,
  detectStructuralLoss,
  findUniqueMatch,
  getNewFileExtensionDenialReason,
  getWriteDenialReason,
  looksBinary,
  maxCodeFileBytes,
  maxWriteBytes,
  normalizeToLf,
  resolveProjectPath,
  toProjectRelativePath,
} from './code-tools-utils';
import {
  countFilesInScope,
  countMatchesInScope,
  createProjectScope,
  globInScope,
  grepInScope,
  listDirInScope,
  readFileInScope,
  type CountMatchesArgs,
  type GrepArgs,
} from './file-scope-engine';

export { createProjectScope, countMatchesInScope, globInScope, grepInScope, listDirInScope, readFileInScope } from './file-scope-engine';

/** 统计工程内的文件数（受默认排除规则与上限约束），用于导入时提示工程规模。 */
export async function countProjectFiles(projectRoot: string, limit: number, signal: AbortSignal) {
  return countFilesInScope(createProjectScope(projectRoot), path.resolve(projectRoot), limit, signal);
}

export async function codeListDir(
  projectRoot: string,
  args: { dirPath?: string; recursive?: boolean; limit?: number },
  signal: AbortSignal,
): Promise<ToolResult> {
  return listDirInScope(createProjectScope(projectRoot), args, signal);
}

export async function codeReadFile(
  projectRoot: string,
  args: { filePath: string; startLine?: number; maxLines?: number },
  signal: AbortSignal,
  options?: { conversationId?: string },
): Promise<ToolResult> {
  const conversationId = options?.conversationId;
  return readFileInScope(createProjectScope(projectRoot), args, signal, {
    recordRead: conversationId
      ? (absolutePath, record) => recordFileRead(conversationId, absolutePath, record)
      : undefined,
  });
}

export async function codeGlob(
  projectRoot: string,
  args: { pattern: string; dirPath?: string; limit?: number },
  signal: AbortSignal,
): Promise<ToolResult> {
  return globInScope(createProjectScope(projectRoot), args, signal);
}

export async function codeGrep(projectRoot: string, args: GrepArgs, signal: AbortSignal): Promise<ToolResult> {
  return grepInScope(createProjectScope(projectRoot), args, signal);
}

export async function codeCountMatches(projectRoot: string, args: CountMatchesArgs, signal: AbortSignal): Promise<ToolResult> {
  return countMatchesInScope(createProjectScope(projectRoot), args, signal);
}

function toErrorResult(error: unknown, fallback: string): ToolResult {
  const message = error instanceof Error ? error.message : fallback;
  return { ok: false, content: '', error: message };
}

type FileReadRecord = {
  mtimeMs: number;
  size: number;
  fullyRead: boolean;
};

/**
 * 每个会话内"已读过哪些文件、读的时候是什么状态"。
 * 写入前据此拦两类事故：模型凭猜测改文件，以及用户在 IDE 里改过之后模型基于旧内容覆盖。
 */
const fileReadRecords = new Map<string, FileReadRecord>();

function buildReadRecordKey(conversationId: string, absolutePath: string) {
  return `${conversationId}::${absolutePath}`;
}

export function recordFileRead(conversationId: string, absolutePath: string, record: FileReadRecord) {
  fileReadRecords.set(buildReadRecordKey(conversationId, absolutePath), record);
}

export function clearFileReadRecords(conversationId: string) {
  for (const key of fileReadRecords.keys()) {
    if (key.startsWith(`${conversationId}::`)) {
      fileReadRecords.delete(key);
    }
  }
}

export type CodeWriteContext = {
  projectRoot: string;
  projectId: string;
  conversationId: string;
  signal: AbortSignal;
};

type PreparedWrite = {
  targetPath: string;
  relativePath: string;
  exists: boolean;
  oldText: string;
  /** 已按目标文件原有行尾还原，可直接落盘。 */
  nextText: string;
  diff: string;
  summary: string;
};

function assertWritableTarget(relativePath: string, exists: boolean) {
  const denial = getWriteDenialReason(relativePath);
  if (denial) {
    throw new Error(denial);
  }

  if (!exists) {
    const extensionDenial = getNewFileExtensionDenialReason(relativePath);
    if (extensionDenial) {
      throw new Error(extensionDenial);
    }
  }
}

async function readExistingFile(targetPath: string, relativePath: string) {
  let stat;
  try {
    stat = await fs.stat(targetPath);
  } catch {
    return null;
  }

  if (!stat.isFile()) {
    throw new Error(`${relativePath} 不是文件，无法写入。`);
  }
  if (stat.size > maxCodeFileBytes) {
    throw new Error(`${relativePath} 超过 ${Math.floor(maxCodeFileBytes / 1024 / 1024)}MB，不支持修改。`);
  }

  const buffer = await fs.readFile(targetPath);
  if (looksBinary(buffer)) {
    throw new Error(`${relativePath} 疑似二进制文件，不支持修改。`);
  }

  return { stat, text: buffer.toString('utf8') };
}

/** 校验这次写入之前确实读过该文件，且文件在那之后没有被外部改动。 */
function assertFreshRead(
  context: CodeWriteContext,
  targetPath: string,
  relativePath: string,
  stat: { mtimeMs: number; size: number },
  options: { requireFullRead: boolean },
) {
  const record = fileReadRecords.get(buildReadRecordKey(context.conversationId, targetPath));
  if (!record) {
    throw new Error(`请先用 code_read_file 读取 ${relativePath}，确认现有内容后再修改。`);
  }

  if (record.mtimeMs !== stat.mtimeMs || record.size !== stat.size) {
    throw new Error(`${relativePath} 在你读取之后已被外部修改，请重新用 code_read_file 读取最新内容再改。`);
  }

  if (options.requireFullRead && !record.fullyRead) {
    throw new Error(`${relativePath} 只被分页读取过一部分，整体覆盖前请先完整读完（或改用 code_edit_file 做局部替换）。`);
  }
}

/** 备份目录：按会话归属，便于用户回溯"这轮对话都改了什么"。 */
function getBackupDirectory(conversationId: string) {
  return path.join(getAppDataRoot(), 'code-edits', conversationId);
}

/** 备份文件名的自增序号：同一毫秒内连续改同一个文件时避免相互覆盖。 */
let backupSequence = 0;

function buildBackupFileName(relativePath: string) {
  const flattened = relativePath.replace(/[\\/]/g, '__').replace(/[^\w.\-]/g, '_');
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\./g, '');
  backupSequence += 1;
  return `${timestamp}-${String(backupSequence).padStart(4, '0')}-${flattened}`;
}

async function backupBeforeWrite(context: CodeWriteContext, relativePath: string, originalText: string) {
  const directory = getBackupDirectory(context.conversationId);
  const backupPath = path.join(directory, buildBackupFileName(relativePath));

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(backupPath, originalText, 'utf8');
  await appendMainLog('INFO', `Backed up ${relativePath} before write: ${backupPath}`);

  return backupPath;
}

/** 先写同目录临时文件再 rename，避免写入中途失败留下半截文件。 */
async function writeFileAtomic(targetPath: string, content: string) {
  const tempPath = `${targetPath}.ergaster-tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  try {
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

/** 整体写入的预检：解析路径、校验黑名单与新鲜读取，并算出 diff。不落盘。 */
export async function prepareCodeWriteFile(
  context: CodeWriteContext,
  args: { filePath: string; content: string },
): Promise<PreparedWrite> {
  const targetPath = resolveProjectPath(context.projectRoot, args.filePath);
  const relativePath = toProjectRelativePath(context.projectRoot, targetPath);

  if (Buffer.byteLength(args.content, 'utf8') > maxWriteBytes) {
    throw new Error(`写入内容超过 ${Math.floor(maxWriteBytes / 1024 / 1024)}MB，请拆分处理。`);
  }

  const existing = await readExistingFile(targetPath, relativePath);
  assertWritableTarget(relativePath, existing !== null);

  if (existing) {
    assertFreshRead(context, targetPath, relativePath, existing.stat, { requireFullRead: true });
  }

  const oldText = existing?.text ?? '';
  // 已有文件沿用其行尾；新文件统一用 LF
  const lineEnding = existing ? detectDominantLineEnding(oldText) : '\n';
  const nextText = applyLineEnding(args.content, lineEnding);

  if (existing && normalizeToLf(nextText) === normalizeToLf(oldText)) {
    throw new Error(`${relativePath} 的内容与现有内容完全相同，无需写入。`);
  }

  const diff = buildUnifiedDiff(relativePath, normalizeToLf(oldText), normalizeToLf(nextText));
  const stats = buildDiffStats(normalizeToLf(oldText), normalizeToLf(nextText));

  return {
    targetPath,
    relativePath,
    exists: existing !== null,
    oldText,
    nextText,
    diff,
    summary: existing
      ? `覆盖 ${relativePath}（+${stats.added} / -${stats.removed} 行）`
      : `新建 ${relativePath}（${stats.added} 行）`,
  };
}

/** 局部替换的预检：定位唯一匹配、做结构性破坏检查，并算出 diff。不落盘。 */
export async function prepareCodeEditFile(
  context: CodeWriteContext,
  args: { filePath: string; search: string; replace: string },
): Promise<PreparedWrite & { matchKind: string }> {
  const targetPath = resolveProjectPath(context.projectRoot, args.filePath);
  const relativePath = toProjectRelativePath(context.projectRoot, targetPath);

  const existing = await readExistingFile(targetPath, relativePath);
  if (!existing) {
    throw new Error(`${relativePath} 不存在。新建文件请用 code_write_file。`);
  }

  assertWritableTarget(relativePath, true);
  assertFreshRead(context, targetPath, relativePath, existing.stat, { requireFullRead: false });

  if (args.search === args.replace) {
    throw new Error('search 与 replace 完全相同，这次调用不会产生任何改动。');
  }

  const structuralLoss = detectStructuralLoss(args.search, args.replace);
  if (structuralLoss) {
    throw new Error(structuralLoss);
  }

  const lineEnding = detectDominantLineEnding(existing.text);
  const oldLf = normalizeToLf(existing.text);
  const match = findUniqueMatch(oldLf, normalizeToLf(args.search));
  const replaceLf = normalizeToLf(args.replace);
  const nextLf = `${oldLf.slice(0, match.start)}${replaceLf}${oldLf.slice(match.end)}`;

  // 防御宿主/传输层把内容改写掉：替换段必须真的出现在结果里
  if (replaceLf !== '' && !nextLf.includes(replaceLf)) {
    throw new Error('替换后的内容校验失败，replace 文本没有出现在结果中，请重试。');
  }

  const stats = buildDiffStats(oldLf, nextLf);
  const matchKindLabel = match.kind === 'exact'
    ? '精确匹配'
    : match.kind === 'indentation'
      ? '忽略缩进匹配'
      : '归一化引号/破折号后匹配';

  return {
    targetPath,
    relativePath,
    exists: true,
    oldText: existing.text,
    nextText: applyLineEnding(nextLf, lineEnding),
    diff: buildUnifiedDiff(relativePath, oldLf, nextLf),
    summary: `修改 ${relativePath}（+${stats.added} / -${stats.removed} 行，${matchKindLabel}）`,
    matchKind: matchKindLabel,
  };
}

async function commitPreparedWrite(context: CodeWriteContext, prepared: PreparedWrite): Promise<ToolResult> {
  context.signal.throwIfAborted();

  const backupPath = prepared.exists
    ? await backupBeforeWrite(context, prepared.relativePath, prepared.oldText)
    : null;

  await writeFileAtomic(prepared.targetPath, prepared.nextText);

  // 写入后刷新读取记录，避免同一轮里连续两次修改被误判为"外部改动"
  try {
    const stat = await fs.stat(prepared.targetPath);
    recordFileRead(context.conversationId, prepared.targetPath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      fullyRead: true,
    });
  } catch {
    // 记录刷新失败不影响写入结果，下次写入会要求重新读取
  }

  const lines = [
    prepared.summary,
    backupPath ? `原文件已备份：${backupPath}` : '（新建文件，无需备份）',
    '',
    prepared.diff,
  ];

  return { ok: true, content: lines.join('\n') };
}

export async function codeWriteFile(
  context: CodeWriteContext,
  args: { filePath: string; content: string },
): Promise<ToolResult> {
  try {
    const prepared = await prepareCodeWriteFile(context, args);
    return commitPreparedWrite(context, prepared);
  } catch (error) {
    return toErrorResult(error, '写入文件失败。');
  }
}

export async function codeEditFile(
  context: CodeWriteContext,
  args: { filePath: string; search: string; replace: string },
): Promise<ToolResult> {
  try {
    const prepared = await prepareCodeEditFile(context, args);
    return commitPreparedWrite(context, prepared);
  } catch (error) {
    return toErrorResult(error, '编辑文件失败。');
  }
}

