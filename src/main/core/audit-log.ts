import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentAuditEntry, ToolAuditEntry } from '../../shared/tools';
import type { MemoryAuditEntry } from '../../shared/memory';
import { clipLogText } from '../tools/tool-helpers';

const logDirectory = path.join(app.getPath('userData'), 'log');
const auditLogPath = path.join(logDirectory, 'audit.log');
const mainLogPath = path.join(logDirectory, 'main.log');
const dumpReqLogPath = path.join(logDirectory, 'dump-req.log');
const memoryAuditLogPath = path.join(logDirectory, 'memory-audit.log');

/** 单个日志文件的体积上限，超过后轮转成 .1；因此每种日志最多占用两倍此值。 */
const maxLogFileBytes = 5 * 1024 * 1024;
/** 审计条目里 detail 的字符上限。工具结果常常是整份源码或 diff。 */
const maxAuditDetailLength = 2000;
/** 审计条目里 summary 的字符上限。 */
const maxAuditSummaryLength = 300;

// 文件体积缓存：避免每写一行都 stat 一次。轮转与追加都会同步更新这里的值。
const logFileSizes = new Map<string, number>();

function sanitizeText(value: string) {
  // return value
  //   .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
  //   .replace(/(authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*([^,;\]}\s]+)/gi, '$1=***')
  //   .replace(/(authorization|proxy-authorization|cookie|set-cookie|x-api-key)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
  //   .replace(/sk-[A-Za-z0-9_-]+/gi, 'sk-***')
  //   .replace(/([A-Za-z]:\\[^\s"]+)/g, '[path]')
  //   .slice(0, 1000);
  return value;
}

async function ensureLogDirectory() {
  await fs.mkdir(logDirectory, { recursive: true });
}

async function getLogFileSize(filePath: string) {
  const cached = logFileSizes.get(filePath);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const stat = await fs.stat(filePath);
    logFileSizes.set(filePath, stat.size);
    return stat.size;
  } catch {
    logFileSizes.set(filePath, 0);
    return 0;
  }
}

/** 超出上限时把当前文件挪成 .1（覆盖上一份备份），只保留一代历史。 */
async function rotateIfNeeded(filePath: string, incomingBytes: number) {
  const size = await getLogFileSize(filePath);
  if (size + incomingBytes <= maxLogFileBytes) {
    return;
  }

  try {
    await fs.rm(`${filePath}.1`, { force: true });
    await fs.rename(filePath, `${filePath}.1`);
    logFileSizes.set(filePath, 0);
  } catch {
    // 轮转失败就继续往原文件追加：日志问题不该打断主流程
  }
}

async function appendLogLine(filePath: string, line: string) {
  await ensureLogDirectory();
  const bytes = Buffer.byteLength(line, 'utf8');
  await rotateIfNeeded(filePath, bytes);
  await fs.appendFile(filePath, line, 'utf8');
  logFileSizes.set(filePath, (await getLogFileSize(filePath)) + bytes);
}

async function appendAuditLine(payload: Record<string, unknown>) {
  await appendLogLine(auditLogPath, `${JSON.stringify(payload)}\n`);
}

export async function appendMainLog(level: 'INFO' | 'WARN' | 'ERROR', message: string) {
  await appendLogLine(mainLogPath, `[${new Date().toISOString()}] [${level}] ${sanitizeText(message)}\n`);
}

/** 调试用：原始 HTTP 请求 dump（由 debug-config 的 test.ini 开关控制），复用同一套轮转机制。 */
export async function appendDumpReqLog(line: string) {
  await appendLogLine(dumpReqLogPath, line);
}

export async function appendToolAuditLog(entry: ToolAuditEntry) {
  await appendAuditLine({
    scope: 'tool',
    ...entry,
    summary: clipLogText(sanitizeText(entry.summary), maxAuditSummaryLength),
    detail: clipLogText(sanitizeText(entry.detail), maxAuditDetailLength),
  });
}

export async function appendAgentAuditLog(entry: AgentAuditEntry) {
  await appendAuditLine({
    scope: 'agent',
    ...entry,
    summary: clipLogText(sanitizeText(entry.summary), maxAuditSummaryLength),
    detail: clipLogText(sanitizeText(entry.detail), maxAuditDetailLength),
  });
}

/** 记忆操作审计：写入独立文件 memory-audit.log，与工具/agent 审计分开，避免被高频日志按体积轮转冲掉。 */
export async function appendMemoryAuditLog(entry: MemoryAuditEntry) {
  const payload = {
    ts: new Date().toISOString(),
    ...entry,
    ...(entry.content !== undefined ? { content: clipLogText(sanitizeText(entry.content), maxAuditDetailLength) } : {}),
  };
  await appendLogLine(memoryAuditLogPath, `${JSON.stringify(payload)}\n`);
}

export function getAuditLogPath() {
  return auditLogPath;
}

export function getMainLogPath() {
  return mainLogPath;
}

export function getMemoryAuditLogPath() {
  return memoryAuditLogPath;
}
