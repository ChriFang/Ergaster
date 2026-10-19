import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 展开路径开头的 ~ / ~/ 到用户主目录。
 * Node 的 path.resolve 不处理 ~，而模型经常用 ~ 传路径（如 ~/Documents/ErgasterDrafts），
 * 不展开会让路径落到 <cwd>/~ 下、匹配不上允许目录。仅处理当前用户家目录，~otheruser 原样保留。
 */
export function expandHomePath(targetPath: string): string {
  if (targetPath === '~') {
    return os.homedir();
  }
  if (targetPath.startsWith('~/') || targetPath.startsWith('~\\')) {
    return path.join(os.homedir(), targetPath.slice(2));
  }
  return targetPath;
}

export function summarizeJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function truncateText(value: string, limit: number) {
  if (value.length <= limit) {
    return {
      text: value,
      truncated: false,
    };
  }

  return {
    text: `${value.slice(0, limit)}\n...[truncated]`,
    truncated: true,
  };
}

/**
 * 日志专用截断：保留前 limit 个字符并标注被丢弃的字符数。
 * 工具参数与工具结果里经常整段夹带源码，不截断会让日志体积失控。
 */
export function clipLogText(value: string, limit: number) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}…[已截断 ${value.length - limit} 字符]`;
}


/** 文本/代码类草稿后缀白名单：写入内容是 UTF-8 纯文本，后缀必须与内容真实格式一致。 */
export const TEXT_DRAFT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.html', '.htm', '.xml', '.svg',
  '.yaml', '.yml', '.toml', '.ini', '.conf', '.log',
  '.sql', '.css', '.scss', '.less', '.vue', '.proto', '.graphql',
  '.py', '.ts', '.tsx', '.jsx', '.java', '.kt', '.swift', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.pl', '.lua', '.r', '.dart',
]);

/**
 * 双击/系统默认关联即可执行的脚本与可执行后缀：拒绝写入。
 * 防止"草稿写入 + open_path"绕过 run_command 的确认链直接执行脚本。
 * .js 也在列：Windows wscript 会把 .js 当 JScript 执行。
 */
export const BLOCKED_DRAFT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.bat', '.cmd', '.com', '.cpl', '.exe', '.hta', '.inf', '.jar', '.js', '.jse',
  '.lnk', '.msi', '.pif', '.ps1', '.scr', '.url', '.vbs', '.vbe', '.wsf', '.wsh',
]);

/** 光栅图片后缀：内容必须是真实二进制，只能走 create_image_draft（base64 + 魔数校验）。 */
export const IMAGE_DRAFT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico',
]);

export const IMAGE_DRAFT_MAX_BYTES = 10 * 1024 * 1024;

export function getFileExtension(fileName: string) {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1).slice(fileName.lastIndexOf('\\') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/**
 * 文本草稿后缀解析：命中白名单原样返回；无后缀补 .txt；
 * 脚本/图片/office 等其他后缀给出明确的改用指引或可用列表。
 */
export function resolveTextDraftExtension(fileName: string) {
  const extension = getFileExtension(fileName);

  if (!extension) {
    return `${fileName}.txt`;
  }

  if (BLOCKED_DRAFT_EXTENSIONS.has(extension)) {
    throw new Error(`不允许创建 ${extension} 类脚本/可执行草稿文件：草稿工具只能生成文档与数据文件。`);
  }

  if (TEXT_DRAFT_EXTENSIONS.has(extension)) {
    return fileName;
  }

  if (IMAGE_DRAFT_EXTENSIONS.has(extension)) {
    throw new Error('图片草稿请改用 create_image_draft 工具（base64 数据 + 格式校验）。');
  }

  if (extension === '.xlsx') {
    throw new Error('Excel 草稿请改用 create_excel_draft 工具。');
  }

  if (extension === '.docx') {
    throw new Error('Word 草稿请改用 create_docx_draft 工具。');
  }

  if (extension === '.pdf') {
    throw new Error('PDF 草稿请改用 create_pdf_draft 工具。');
  }

  throw new Error(`不支持的草稿后缀 ${extension}。支持的文本/代码后缀：${[...TEXT_DRAFT_EXTENSIONS].join(' ')}。`);
}

type ImageMagicCheck = (bytes: Buffer) => boolean;

const IMAGE_MAGIC_CHECKS: Record<string, ImageMagicCheck> = {
  '.png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.jpg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  '.jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  '.gif': (bytes) => ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('latin1')),
  '.webp': (bytes) => bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP',
  '.bmp': (bytes) => bytes[0] === 0x42 && bytes[1] === 0x4d,
  '.ico': (bytes) => bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00,
};

/**
 * 图片草稿解码：base64（容忍 data URL 前缀与空白）→ 大小上限 → 魔数与后缀一致性校验。
 * 校验失败一律抛错，防止模型幻觉出的伪 base64 落成坏图。
 */
export function decodeImageDraft(base64Data: string, fileName: string): { buffer: Buffer } {
  const extension = getFileExtension(fileName);
  if (!IMAGE_DRAFT_EXTENSIONS.has(extension)) {
    throw new Error(`图片草稿仅支持后缀：${[...IMAGE_DRAFT_EXTENSIONS].join(' ')}。`);
  }

  const normalized = base64Data.trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error('base64Data 不是合法的 base64 图片数据。');
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.length === 0) {
    throw new Error('base64Data 解码后为空。');
  }
  if (buffer.length > IMAGE_DRAFT_MAX_BYTES) {
    throw new Error(`图片超过大小上限（${Math.round(IMAGE_DRAFT_MAX_BYTES / 1024 / 1024)}MB）。`);
  }

  const check = IMAGE_MAGIC_CHECKS[extension];
  if (!check || !check(buffer)) {
    throw new Error(`图片内容与 ${extension} 格式不符（魔数校验失败），请确认传入的是真实的 ${extension} 文件数据。`);
  }

  return { buffer };
}

export function ensureXlsxExtension(fileName: string) {
  return fileName.toLowerCase().endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
}

/** 图片预览支持的后缀：光栅图 + SVG（svg 在 <img> 中渲染不执行脚本，可安全内嵌）。 */
export const PREVIEW_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
]);

/** 文本预览支持的后缀：与文本草稿一致，但 svg 走图片预览。 */
export const PREVIEW_TEXT_EXTENSIONS: ReadonlySet<string> = new Set(
  [...TEXT_DRAFT_EXTENSIONS].filter((extension) => extension !== '.svg'),
);

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** 返回图片后缀对应的 MIME；不在支持列表时返回 null。 */
export function resolveImagePreviewMime(extension: string) {
  return IMAGE_MIME_BY_EXTENSION[extension.toLowerCase()] ?? null;
}


/**
 * 区分「执行超时」与「用户主动取消」。
 *
 * AbortSignal.any 会把首个中断信号的 reason 透传过来：AbortSignal.timeout 给的是
 * TimeoutError，AbortController.abort() 给的是 AbortError。超时可以把已产生的部分
 * 输出返回给模型，用户取消则应该直接中止。
 */
export function isTimeoutAbort(signal?: AbortSignal) {
  const reason: unknown = signal?.reason;
  return reason instanceof DOMException && reason.name === 'TimeoutError';
}

export type IdleDeadline = {
  signal: AbortSignal;
  /** 有新进展时刷新计时。用于流式读取：只要还在出数据就不算超时。 */
  refresh: () => void;
  dispose: () => void;
};

/**
 * 空闲超时信号：从「整体耗时上限」改成「多久没有新进展才算超时」。
 *
 * AbortSignal.timeout 是一次性的整体预算，用在流式响应上会把「连接健康但输出很长」
 * 的请求也掐掉；这里允许调用方在每次拿到数据后 refresh，从而只在真正卡住时中断。
 * 外层 signal（用户取消）会以原 reason 透传，保证 isTimeoutAbort 仍能区分两者。
 */
export function createIdleDeadline(input: { signal: AbortSignal; timeoutMs: number; timeoutMessage: string }): IdleDeadline {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onOuterAbort = () => {
    controller.abort(input.signal.reason);
  };

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const arm = () => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      controller.abort(new DOMException(input.timeoutMessage, 'TimeoutError'));
    }, input.timeoutMs);
    timer.unref?.();
  };

  if (input.signal.aborted) {
    controller.abort(input.signal.reason);
  } else {
    input.signal.addEventListener('abort', onOuterAbort, { once: true });
    arm();
  }

  return {
    signal: controller.signal,
    refresh: () => {
      if (!controller.signal.aborted) {
        arm();
      }
    },
    dispose: () => {
      clear();
      input.signal.removeEventListener('abort', onOuterAbort);
    },
  };
}



export function sanitizeFileName(fileName: string) {
  return fileName.replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * 清洗草稿相对路径：支持 `/` 分隔的相对子目录（如 `icons/游戏/bot.svg`），
 * 便于按项目/类型把生成的文件归档到子目录。
 *
 * 逐段调用 sanitizeFileName 清洗非法字符，丢弃空段与 `.`/`..`（防目录穿越，
 * 整体逃逸另由 resolveChildPath 兜底），再以 `/` 重新连接。
 */
export function sanitizeDraftRelativePath(fileName: string): string {
  return fileName
    .split(/[\\/]+/)
    .map((segment) => sanitizeFileName(segment.trim()))
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .join('/');
}

export function resolveChildPath(root: string, child: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, child);
  const normalizedRoot = resolvedRoot.toLowerCase();
  const normalizedTarget = resolvedTarget.toLowerCase();

  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error('目标路径超出允许目录范围。');
  }

  return resolvedTarget;
}
