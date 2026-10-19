import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { assertNoSsrf } from '../skills/skill-source';
import { BLOCKED_DRAFT_EXTENSIONS, pathExists, sanitizeFileName } from './tool-helpers';

/**
 * 下载落盘引擎（零 Electron 依赖，可被 node --test 直接打包）。
 * 只负责 URL/SSRF 校验、重定向 host 策略、文件名推导与流式落盘；
 * 域名白名单的审批判定与 allowedPaths 沙箱校验由调用方（tool-registry / system-tools）负责。
 */

/** 单个下载文件的体积上限。 */
export const maxDownloadBytes = 500 * 1024 * 1024;
/** 最多跟随的重定向次数。 */
export const maxDownloadRedirects = 5;
/** 单次下载的总耗时上限。 */
export const downloadTimeoutMs = 10 * 60 * 1000;

const defaultDownloadFileName = 'download.bin';

/** 校验下载 URL：只允许 http/https、不允许内嵌账号密码、拒绝内网/回环/元数据地址。 */
export function validateDownloadUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error(`非法 URL：${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅支持 http 或 https 协议。');
  }
  if (url.username || url.password) {
    throw new Error('URL 中不允许携带账号密码。');
  }
  assertNoSsrf(url.hostname);
  return url;
}

/** 主机是否在下载域名白名单内（小写精确匹配，不支持通配）。 */
export function isHostAllowed(host: string, allowedHosts: readonly string[] | undefined): boolean {
  const normalized = host.trim().toLowerCase();
  return Boolean(normalized) && (allowedHosts ?? []).some((item) => item.trim().toLowerCase() === normalized);
}

export type DownloadApproval =
  | { decision: 'auto'; host: string }
  | { decision: 'confirm'; host: string }
  | { decision: 'reject'; host: string; reason: string };

/**
 * download_file 的审批判定（不读取全局「自动执行」清单）：
 * - URL 非法 / 内网地址 → reject
 * - 主机在白名单 → auto
 * - 不在白名单：无人值守或工作流链路 → reject；交互式会话 → confirm（确认卡可勾选「总是允许此域名」）
 */
export function resolveDownloadApproval(input: {
  url: string;
  allowedHosts: readonly string[] | undefined;
  unattended: boolean;
  workflow: boolean;
}): DownloadApproval {
  let host: string;
  try {
    host = validateDownloadUrl(input.url).hostname.toLowerCase();
  } catch (error) {
    return { decision: 'reject', host: '', reason: error instanceof Error ? error.message : '下载链接不合法。' };
  }
  if (isHostAllowed(host, input.allowedHosts)) {
    return { decision: 'auto', host };
  }
  if (input.unattended || input.workflow) {
    return {
      decision: 'reject',
      host,
      reason: `域名 ${host} 不在下载白名单内，${input.unattended ? '无人值守' : '工作流'}链路不允许下载。请先在交互式会话中确认一次并勾选「总是允许此域名」，或在设置中添加该域名。`,
    };
  }
  return { decision: 'confirm', host };
}

/** 解析 Content-Disposition 里的文件名：优先 RFC 5987 的 filename*，其次 filename。 */
export function parseContentDispositionFileName(header: string | null | undefined): string | null {
  if (!header) {
    return null;
  }
  const extended = /filename\*\s*=\s*(?:[\w-]+)?'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // 编码非法时回退到普通 filename
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  if (plain) {
    const value = (plain[2] ?? plain[1]).trim().replace(/^"|"$/g, '');
    return value || null;
  }
  return null;
}

/** 文件名后缀是否属于可直接执行的脚本/程序（禁止下载落盘，防止"下载 + open_path"绕过执行确认）。 */
export function isBlockedDownloadExtension(fileName: string): boolean {
  return BLOCKED_DRAFT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/**
 * 推导落盘文件名：显式文件名 > Content-Disposition > URL 路径末段 > 默认名。
 * 结果只保留单段文件名（去掉目录成分与非法字符）；可执行后缀直接拒绝。
 */
export function deriveDownloadFileName(input: { explicit?: string; contentDisposition?: string | null; url: URL }): string {
  const fromUrl = (() => {
    const last = input.url.pathname.split('/').filter(Boolean).pop() ?? '';
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  })();
  const candidates = [input.explicit, parseContentDispositionFileName(input.contentDisposition), fromUrl];
  let fileName = defaultDownloadFileName;
  for (const candidate of candidates) {
    const base = (candidate ?? '').split(/[\\/]+/).pop() ?? '';
    const cleaned = sanitizeFileName(base.trim()).replace(/[\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
    if (cleaned && cleaned !== '.' && cleaned !== '..') {
      fileName = cleaned;
      break;
    }
  }
  if (isBlockedDownloadExtension(fileName)) {
    throw new Error(`不允许下载可执行脚本/程序类文件：${fileName}`);
  }
  return fileName;
}

/**
 * 解析并校验重定向目标：逐跳复检协议与 SSRF；
 * 目标 host 必须是原始 host（本次已获批准）或在白名单内，否则中止并提示加入白名单。
 */
export function resolveRedirectTarget(
  location: string,
  current: URL,
  originalHost: string,
  allowedHosts: readonly string[] | undefined,
): URL {
  const next = validateDownloadUrl(new URL(location, current).toString());
  const host = next.hostname.toLowerCase();
  if (host !== originalHost.toLowerCase() && !isHostAllowed(host, allowedHosts)) {
    throw new Error(`下载被重定向到未授权的域名 ${host}，已中止。如确认可信，请将其加入下载域名白名单后重试。`);
  }
  return next;
}

/** 目标已存在时追加 " (2)"、" (3)"… 避免覆盖已有文件。 */
async function resolveUniqueTargetPath(destDir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  let candidate = path.join(destDir, fileName);
  for (let index = 2; await pathExists(candidate); index += 1) {
    candidate = path.join(destDir, `${stem} (${index})${ext}`);
  }
  return candidate;
}

/** 字节计数透传流：超过上限时报错中止管道。 */
function createByteLimiter(maxBytes: number, onBytes: (total: number) => void) {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new Error(`下载体积超过上限（${Math.floor(maxBytes / 1024 / 1024)}MB），已中止。`));
        return;
      }
      onBytes(total);
      callback(null, chunk);
    },
  });
}

export type DownloadResult = {
  filePath: string;
  fileName: string;
  bytes: number;
  finalUrl: string;
};

export type DownloadOptions = {
  url: string;
  /** 已通过 allowedPaths 校验且已存在的目标目录。 */
  destDir: string;
  fileName?: string;
  allowedHosts?: readonly string[];
  signal?: AbortSignal;
  maxBytes?: number;
  timeoutMs?: number;
  /** 测试注入用；缺省使用全局 fetch。 */
  fetchImpl?: typeof fetch;
};

/** 下载到目标目录：手动跟随重定向（逐跳复检），流式写临时文件后 rename，失败时清理临时文件。 */
export async function downloadToDirectory(options: DownloadOptions): Promise<DownloadResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? maxDownloadBytes;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? downloadTimeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const originalUrl = validateDownloadUrl(options.url);
  const originalHost = originalUrl.hostname.toLowerCase();
  let currentUrl = originalUrl;

  for (let redirect = 0; redirect <= maxDownloadRedirects; redirect += 1) {
    const response = await fetchImpl(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: { 'user-agent': 'ergaster-download', accept: '*/*' },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('重定向缺少 Location 头。');
      }
      currentUrl = resolveRedirectTarget(location, currentUrl, originalHost, options.allowedHosts);
      continue;
    }
    if (!response.ok) {
      throw new Error(`下载失败，HTTP ${response.status}`);
    }

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`下载体积超过上限（${Math.floor(maxBytes / 1024 / 1024)}MB），已中止。`);
    }
    if (!response.body) {
      throw new Error('响应没有正文。');
    }

    const fileName = deriveDownloadFileName({
      explicit: options.fileName,
      contentDisposition: response.headers.get('content-disposition'),
      url: currentUrl,
    });
    const targetPath = await resolveUniqueTargetPath(options.destDir, fileName);
    const tempPath = `${targetPath}.ergaster-download-${process.pid}-${Date.now()}`;

    let bytes = 0;
    try {
      await pipeline(
        Readable.fromWeb(response.body as unknown as NodeWebReadableStream),
        createByteLimiter(maxBytes, (total) => {
          bytes = total;
        }),
        createWriteStream(tempPath),
        { signal },
      );
      await fs.rename(tempPath, targetPath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }

    return { filePath: targetPath, fileName: path.basename(targetPath), bytes, finalUrl: currentUrl.toString() };
  }

  throw new Error('重定向次数过多。');
}
