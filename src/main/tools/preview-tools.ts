import fs from 'node:fs/promises';
import path from 'node:path';
import type { FilePreviewPayload } from '../../shared/agent';
import type { ToolResult } from '../../shared/tools';
import { appendMainLog } from '../core/audit-log';
import {
  PREVIEW_IMAGE_EXTENSIONS,
  PREVIEW_TEXT_EXTENSIONS,
  getFileExtension,
  resolveImagePreviewMime,
  truncateText,
} from './tool-helpers';
import { assertWithinAllowedPaths } from './system-tools';

const previewImageMaxBytes = 8 * 1024 * 1024;
const previewTextMaxBytes = 2 * 1024 * 1024;
const previewTextMaxLength = 12_000;
const previewDocxMaxBytes = 10 * 1024 * 1024;

function toToolError(operation: string, targetPath: string, error: unknown, fallback: string): ToolResult {
  if (error instanceof Error && error.name === 'AbortError') {
    throw new Error('工具执行已取消。');
  }

  const message = error instanceof Error ? error.message : fallback;
  void appendMainLog('ERROR', `${operation} failed: ${targetPath}, error: ${message}`);
  return {
    ok: false,
    content: '',
    error: message,
  };
}

function baseFileName(resolvedPath: string) {
  return path.basename(resolvedPath);
}

/** 读取并校验图片文件，成功时把载荷推给会话区，返回给模型的只是轻量确认文本。 */
export async function previewImageFile(filePath: string, context: { signal?: AbortSignal; emitFilePreview?: (payload: FilePreviewPayload) => void }): Promise<ToolResult> {
  let resolvedPath: string;

  try {
    resolvedPath = await assertWithinAllowedPaths(filePath);
  } catch (error) {
    return toToolError('preview_image path validation', filePath, error, '路径验证失败。');
  }

  const extension = getFileExtension(resolvedPath);

  if (!PREVIEW_IMAGE_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      content: '',
      error: `目标文件不是可预览的图片。支持：${[...PREVIEW_IMAGE_EXTENSIONS].join(' ')}。`,
      data: { path: resolvedPath },
    };
  }

  try {
    const stat = await fs.stat(resolvedPath);

    if (!stat.isFile()) {
      return { ok: false, content: '', error: '目标路径不是文件。', data: { path: resolvedPath } };
    }

    if (stat.size > previewImageMaxBytes) {
      return {
        ok: false,
        content: '',
        error: `图片过大（${(stat.size / 1024 / 1024).toFixed(2)}MB），预览最大支持 ${previewImageMaxBytes / 1024 / 1024}MB。可改用 open_path 用系统查看器打开。`,
        data: { path: resolvedPath },
      };
    }

    context.signal?.throwIfAborted();
    const buffer = await fs.readFile(resolvedPath);
    const mimeType = resolveImagePreviewMime(extension)!;
    const payload: FilePreviewPayload = {
      kind: 'image',
      fileName: baseFileName(resolvedPath),
      path: resolvedPath,
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    };

    context.emitFilePreview?.(payload);
    await appendMainLog('INFO', `preview_image success: ${resolvedPath}, size: ${stat.size}`);

    return {
      ok: true,
      content: `已将「${payload.fileName}」推送到会话区预览，用户可以直接看到该图片。`,
      data: { path: resolvedPath, size: stat.size, kind: 'image' },
    };
  } catch (error) {
    return toToolError('preview_image', resolvedPath, error, '图片预览失败。');
  }
}

/** 读取文本类文件，截断后推给会话区。 */
export async function previewTextFile(filePath: string, context: { signal?: AbortSignal; emitFilePreview?: (payload: FilePreviewPayload) => void }): Promise<ToolResult> {
  let resolvedPath: string;

  try {
    resolvedPath = await assertWithinAllowedPaths(filePath);
  } catch (error) {
    return toToolError('preview_text path validation', filePath, error, '路径验证失败。');
  }

  const extension = getFileExtension(resolvedPath);

  // SVG 同时是合法文本草稿后缀，又该按图片渲染：create_text_draft 允许写 .svg 并引导调用
  // preview_text，但 SVG 不在文本预览白名单里，直接判错。这里把图片类文件（含 SVG）转交
  // 图片预览，让模型无论调 preview_text 还是 preview_image 都能把图渲染出来。
  if (PREVIEW_IMAGE_EXTENSIONS.has(extension)) {
    return previewImageFile(filePath, context);
  }

  if (!PREVIEW_TEXT_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      content: '',
      error: `目标文件不是可预览的文本/代码文件。支持：${[...PREVIEW_TEXT_EXTENSIONS].join(' ')}。`,
      data: { path: resolvedPath },
    };
  }

  try {
    const stat = await fs.stat(resolvedPath);

    if (!stat.isFile()) {
      return { ok: false, content: '', error: '目标路径不是文件。', data: { path: resolvedPath } };
    }

    if (stat.size > previewTextMaxBytes) {
      return {
        ok: false,
        content: '',
        error: `文件过大（${(stat.size / 1024 / 1024).toFixed(2)}MB），文本预览最大支持 ${previewTextMaxBytes / 1024 / 1024}MB。`,
        data: { path: resolvedPath },
      };
    }

    context.signal?.throwIfAborted();
    const raw = await fs.readFile(resolvedPath, 'utf-8');
    const preview = truncateText(raw, previewTextMaxLength);
    const payload: FilePreviewPayload = {
      kind: 'text',
      fileName: baseFileName(resolvedPath),
      path: resolvedPath,
      text: preview.text,
      truncated: preview.truncated,
    };

    context.emitFilePreview?.(payload);
    await appendMainLog('INFO', `preview_text success: ${resolvedPath}, size: ${stat.size}`);

    return {
      ok: true,
      content: preview.truncated
        ? `已将「${payload.fileName}」推送到会话区预览，内容过长已截断，完整内容请用 open_path 打开。`
        : `已将「${payload.fileName}」推送到会话区预览，用户可以直接看到完整内容。`,
      data: { path: resolvedPath, size: stat.size, kind: 'text', truncated: preview.truncated },
    };
  } catch (error) {
    return toToolError('preview_text', resolvedPath, error, '文本预览失败。');
  }
}

/** 读取 .docx 并转成 HTML 推给会话区，由 renderer 用 sandboxed iframe 渲染。 */
export async function previewDocxFile(filePath: string, context: { signal?: AbortSignal; emitFilePreview?: (payload: FilePreviewPayload) => void }): Promise<ToolResult> {
  let resolvedPath: string;

  try {
    resolvedPath = await assertWithinAllowedPaths(filePath);
  } catch (error) {
    return toToolError('preview_docx path validation', filePath, error, '路径验证失败。');
  }

  const extension = getFileExtension(resolvedPath);

  if (extension !== '.docx') {
    return {
      ok: false,
      content: '',
      error: extension === '.doc'
        ? '旧版 .doc（二进制 Word）暂不支持预览，请转换为 .docx 后重试。'
        : '目标文件不是 .docx。',
      data: { path: resolvedPath },
    };
  }

  try {
    const stat = await fs.stat(resolvedPath);

    if (!stat.isFile()) {
      return { ok: false, content: '', error: '目标路径不是文件。', data: { path: resolvedPath } };
    }

    if (stat.size > previewDocxMaxBytes) {
      return {
        ok: false,
        content: '',
        error: `文档过大（${(stat.size / 1024 / 1024).toFixed(2)}MB），预览最大支持 ${previewDocxMaxBytes / 1024 / 1024}MB。可改用 open_path 用 Word 打开。`,
        data: { path: resolvedPath },
      };
    }

    context.signal?.throwIfAborted();
    const buffer = await fs.readFile(resolvedPath);
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ buffer });
    const html = (result?.value ?? '').trim();

    if (!html) {
      return {
        ok: false,
        content: '',
        error: 'Word 文档中没有可预览的内容，可能是空文档或纯图片文档。',
        data: { path: resolvedPath },
      };
    }

    const payload: FilePreviewPayload = {
      kind: 'docx',
      fileName: baseFileName(resolvedPath),
      path: resolvedPath,
      html,
    };

    context.emitFilePreview?.(payload);
    await appendMainLog('INFO', `preview_docx success: ${resolvedPath}, size: ${stat.size}, htmlLength: ${html.length}`);

    return {
      ok: true,
      content: `已将「${payload.fileName}」推送到会话区预览，用户可以直接看到文档内容。`,
      data: { path: resolvedPath, size: stat.size, kind: 'docx' },
    };
  } catch (error) {
    return toToolError('preview_docx', resolvedPath, error, 'Word 文档预览失败。');
  }
}
