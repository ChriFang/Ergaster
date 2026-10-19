import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolResult } from '../../shared/tools';
import { sanitizeZipEntryPath } from '../skills/skill-source';

/**
 * 压缩包解压引擎（零 Electron 依赖，可被 node --test 直接打包）。
 * 不做 allowedPaths 沙箱校验——调用方（system-tools）负责把 archivePath/destDir 收敛到允许范围内；
 * 本模块只负责 zip 解析、条目消毒、zip-slip 双保险、体积/数量上限与落盘。
 */

/** 解压安全上限：防止 zip 炸弹与超大释放拖垮磁盘/主进程。 */
export const maxExtractFileCount = 5000;
export const maxExtractSingleFileBytes = 200 * 1024 * 1024; // 单条目解压后上限 200MB
export const maxExtractTotalBytes = 2 * 1024 * 1024 * 1024; // 总解压量上限 2GB

/** 落在 destDir 内的 zip-slip 二次校验（destDir 必须已是 resolve 后的绝对路径）。 */
function isWithinDest(destDir: string, targetPath: string): boolean {
  const normalizedDest = path.resolve(destDir);
  const normalizedTarget = path.resolve(targetPath);
  return normalizedTarget === normalizedDest || normalizedTarget.startsWith(`${normalizedDest}${path.sep}`);
}

/** Windows 保留设备名（不区分大小写，带不带扩展名都不能用作文件名）。 */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * 规范化单段文件名，使其在 Windows 上可落盘：
 * `<>:"|?*` 与控制字符替换为 `_`（`:` 不处理会在 NTFS 上被解释成备用数据流）、
 * 去掉末尾的点和空格、保留设备名前加 `_`。
 */
function normalizeWindowsSegment(segment: string): string {
  let normalized = segment.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
  if (!normalized) {
    normalized = '_';
  }
  if (WINDOWS_RESERVED_NAMES.test(normalized)) {
    normalized = `_${normalized}`;
  }
  return normalized;
}

/** 逐段规范化已消毒的 posix 相对路径（目录段与文件段同一规则，保证同目录条目落到同一处）。 */
export function normalizeArchiveEntryPath(relativePath: string): string {
  return relativePath.split('/').map(normalizeWindowsSegment).join('/');
}

/** 规范化后与已有条目重名（Windows 不区分大小写）时，在文件名扩展名前追加 ~2、~3…… */
function dedupeEntryPath(relativePath: string, used: Set<string>): string {
  if (!used.has(relativePath.toLowerCase())) {
    used.add(relativePath.toLowerCase());
    return relativePath;
  }
  const slash = relativePath.lastIndexOf('/');
  const dir = slash >= 0 ? relativePath.slice(0, slash + 1) : '';
  const base = relativePath.slice(slash + 1);
  const ext = path.posix.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let index = 2; ; index += 1) {
    const candidate = `${dir}${stem}~${index}${ext}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

/**
 * 把 .zip 解压到已校验的目标目录。
 * destDir 必须已存在（调用方负责创建）。路径逃逸、超限时返回 ok:false 并中止。
 */
export async function extractZipToDir(
  archivePath: string,
  destDir: string,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const buffer = await fs.readFile(archivePath);
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);

  const resolvedDest = path.resolve(destDir);
  const written: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  const usedPaths = new Set<string>();
  let totalBytes = 0;

  for (const entryPath of Object.keys(zip.files)) {
    signal?.throwIfAborted();
    const entry = zip.files[entryPath];
    if (entry.dir) {
      continue;
    }

    const sanitizedPath = sanitizeZipEntryPath(entryPath);
    if (!sanitizedPath) {
      return { ok: false, content: '', error: `压缩包含非法条目路径（疑似路径逃逸），已中止：${entryPath}` };
    }
    // Windows 非法字符 / 保留名 / 规范化后重名：改名落盘并在结果里报告
    const relativePath = dedupeEntryPath(normalizeArchiveEntryPath(sanitizedPath), usedPaths);
    if (relativePath !== sanitizedPath) {
      renamed.push({ from: sanitizedPath, to: relativePath });
    }

    const targetPath = path.resolve(resolvedDest, relativePath);
    if (!isWithinDest(resolvedDest, targetPath)) {
      return { ok: false, content: '', error: `条目超出目标目录范围，已中止：${entryPath}` };
    }

    if (written.length >= maxExtractFileCount) {
      return { ok: false, content: '', error: `压缩包文件数超过上限（${maxExtractFileCount}），已中止。` };
    }

    const content = await entry.async('nodebuffer');
    if (content.byteLength > maxExtractSingleFileBytes) {
      return { ok: false, content: '', error: `单个文件解压后超过 ${Math.floor(maxExtractSingleFileBytes / 1024 / 1024)}MB，已中止：${relativePath}` };
    }
    totalBytes += content.byteLength;
    if (totalBytes > maxExtractTotalBytes) {
      return { ok: false, content: '', error: `解压总量超过 ${Math.floor(maxExtractTotalBytes / 1024 / 1024)}MB，已中止。` };
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content);
    written.push(relativePath);
  }

  const shown = written.slice(0, 50);
  const header = `已解压 ${written.length} 个文件到：${resolvedDest}（总 ${(totalBytes / 1024 / 1024).toFixed(2)}MB）`;
  const body = shown.join('\n') + (written.length > shown.length ? `\n…等 ${written.length} 个` : '');
  const renamedNote = renamed.length > 0
    ? `\n\n以下 ${renamed.length} 个条目因文件名含 Windows 不允许的字符/保留名或重名，已改名落盘（原名 → 实际文件名）：\n${renamed
      .slice(0, 50)
      .map((item) => `${item.from} → ${item.to}`)
      .join('\n')}${renamed.length > 50 ? `\n…等 ${renamed.length} 个` : ''}`
    : '';
  return {
    ok: true,
    content: `${header}\n${body}${renamedNote}`,
    data: { destDir: resolvedDest, fileCount: written.length, totalBytes, renamedCount: renamed.length },
  };
}
