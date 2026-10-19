import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { appendDumpReqLog } from './audit-log';
import type { IniConfig } from './debug-config-utils';
import { formatDumpRequestEntry, formatLocalTimestamp, isDumpRequestEnabled, parseIni } from './debug-config-utils';

// mtime+size 缓存：每次模型请求只做一次 stat（微秒级），文件未变化直接命中内存缓存，
// 变化才重新读取解析。开关文件不存在/读取失败缓存为 null（视为关闭）。
let cachedConfig: { mtimeMs: number; size: number; config: IniConfig | null } | null = null;
let nextDumpSeq = 0;

function getTestIniPath() {
  return path.join(app.getPath('userData'), 'test.ini');
}

/**
 * 所有调试开关的统一读取入口（test.ini 位于 Electron userData 目录，
 * 即 %APPDATA%\Ergaster\test.ini）。未来新增开关（如 env）直接查返回的键值表。
 */
export async function readTestIniConfig(): Promise<IniConfig | null> {
  let mtimeMs: number;
  let size: number;

  try {
    const stat = await fs.stat(getTestIniPath());
    mtimeMs = stat.mtimeMs;
    size = stat.size;
  } catch {
    cachedConfig = null;
    return null;
  }

  if (cachedConfig && cachedConfig.mtimeMs === mtimeMs && cachedConfig.size === size) {
    return cachedConfig.config;
  }

  try {
    const content = await fs.readFile(getTestIniPath(), 'utf8');
    const config = parseIni(content);
    cachedConfig = { mtimeMs, size, config };
    return config;
  } catch {
    cachedConfig = null;
    return null;
  }
}

/** dump 功能开启时把原始请求追加到 log/dump-req.log；全程 best-effort，绝不影响模型请求主链路。 */
export async function dumpChatRequestIfEnabled(
  retryLabel: string,
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<void> {
  try {
    const ini = await readTestIniConfig();
    if (!isDumpRequestEnabled(ini)) {
      return;
    }

    nextDumpSeq += 1;
    await appendDumpReqLog(
      formatDumpRequestEntry({
        seq: nextDumpSeq,
        timestamp: formatLocalTimestamp(new Date()),
        retryLabel,
        url,
        headers,
        body,
      }),
    );
  } catch {
    // 调试 dump 的任何异常都静默吞掉，不打断请求
  }
}
