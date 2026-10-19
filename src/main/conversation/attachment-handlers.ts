import { dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AttachmentKind, AttachmentMeta } from '../../shared/attachment';
import type {
  AttachFromPathsResult,
  ImportedImageResult,
  PendingAttachmentInput,
  PersistedAttachmentResult,
} from '../../shared/contracts';
import { addRuntimeAllowedFile, assertWithinAllowedPaths, openPath } from '../tools/system-tools';
import { conversationService } from './conversation-service';

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const pasteTempDirectory = path.join(os.tmpdir(), 'ergaster-paste');

const textExtensions = new Set(['.txt', '.md', '.log', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env']);
const codeExtensions = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.json', '.xml', '.html', '.css',
  '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.kts', '.sh', '.bat', '.ps1', '.sql',
]);
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const wordExtensions = new Set(['.doc', '.docx']);
const excelExtensions = new Set(['.xls', '.xlsx', '.csv']);
const pptExtensions = new Set(['.ppt', '.pptx']);

function sanitizeStoredFileName(fileName: string) {
  return fileName.replace(/[\\/:*?"<>|]/g, '_');
}

function inferAttachmentKind(fileName: string, mimeType: string): AttachmentKind | null {
  const extension = path.extname(fileName).toLowerCase();
  if (mimeType.startsWith('image/') || imageExtensions.has(extension)) {
    return 'image';
  }
  if (mimeType === 'application/pdf' || extension === '.pdf') {
    return 'pdf';
  }
  if (wordExtensions.has(extension) || mimeType.includes('wordprocessingml') || mimeType === 'application/msword') {
    return 'word';
  }
  if (excelExtensions.has(extension) || mimeType.includes('spreadsheetml') || mimeType === 'application/vnd.ms-excel' || mimeType === 'text/csv') {
    return 'excel';
  }
  if (pptExtensions.has(extension) || mimeType.includes('presentationml') || mimeType === 'application/vnd.ms-powerpoint') {
    return 'ppt';
  }
  if (codeExtensions.has(extension)) {
    return 'code';
  }
  if (textExtensions.has(extension) || mimeType.startsWith('text/')) {
    return 'text';
  }
  return null;
}

async function ensureAttachmentConstraints(attachments: PendingAttachmentInput[]) {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new Error(`单条消息最多允许 ${MAX_ATTACHMENTS} 个附件。`);
  }

  for (const attachment of attachments) {
    if (attachment.meta.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new Error(`附件 ${attachment.meta.originalName} 超过大小限制（10MB）。`);
    }

    const kind = inferAttachmentKind(attachment.meta.originalName, attachment.meta.mimeType);
    if (!kind) {
      throw new Error(`不支持的附件类型：${attachment.meta.originalName}`);
    }
  }
}

async function ensurePasteTempDirectory() {
  await fs.mkdir(pasteTempDirectory, { recursive: true });
}

function buildPendingAttachmentInput(localPath: string, meta: AttachmentMeta): PendingAttachmentInput {
  return { localPath, meta };
}

async function buildAttachmentFromPath(filePath: string): Promise<PendingAttachmentInput> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`目标不是文件：${filePath}`);
  }
  if (stat.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(`附件超过大小限制（10MB）：${path.basename(filePath)}`);
  }

  const fileName = path.basename(filePath);
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = extension === '.pdf'
    ? 'application/pdf'
    : extension === '.doc'
      ? 'application/msword'
      : extension === '.docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : extension === '.xls'
          ? 'application/vnd.ms-excel'
          : extension === '.xlsx'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : extension === '.csv'
              ? 'text/csv'
              : extension === '.ppt'
                ? 'application/vnd.ms-powerpoint'
                : extension === '.pptx'
                  ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                  : imageExtensions.has(extension)
                    ? extension === '.svg'
                      ? 'image/svg+xml'
                      : `image/${extension.replace(/^\./, extension === '.jpg' ? 'jpeg' : '')}`
                    : codeExtensions.has(extension) || textExtensions.has(extension)
                      ? 'text/plain'
                      : 'application/octet-stream';
  const kind = inferAttachmentKind(fileName, mimeType);
  if (!kind) {
    throw new Error(`不支持的附件类型：${fileName}`);
  }

  return buildPendingAttachmentInput(filePath, {
    id: crypto.randomUUID(),
    fileName,
    originalName: fileName,
    mimeType,
    size: stat.size,
    kind,
    createdAt: new Date().toISOString(),
  });
}

export function registerAttachmentHandlers() {
  ipcMain.handle('attachment:select-files', async (): Promise<PendingAttachmentInput[]> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '支持的附件',
          extensions: [
            ...imageExtensions,
            'pdf',
            ...wordExtensions,
            ...excelExtensions,
            ...pptExtensions,
            ...textExtensions,
            ...codeExtensions,
          ].map((extension) => extension.replace(/^\./, '')),
        },
      ],
    });

    if (result.canceled) {
      return [];
    }

    const attachments = await Promise.all(result.filePaths.slice(0, MAX_ATTACHMENTS).map((filePath) => buildAttachmentFromPath(filePath)));
    await ensureAttachmentConstraints(attachments);
    return attachments;
  });

  ipcMain.handle('attachment:from-paths', async (_event, filePaths: string[]): Promise<AttachFromPathsResult> => {
    const attachments: PendingAttachmentInput[] = [];
    const unsupportedPaths: string[] = [];
    const errors: string[] = [];
    const supportedPaths: string[] = [];

    // 拖入的文件按类型分流：支持的走附件管线（内容预提取）；不支持的（视频、exe 等）
    // 不再让整批拖拽失败，确认存在后加入运行时工具白名单，交回渲染层以路径引用插入输入区，
    // 由模型调用系统工具处理——与 attachment:persist 的白名单信任级别一致（用户主动拖入）。
    for (const filePath of filePaths.slice(0, MAX_ATTACHMENTS)) {
      const kind = inferAttachmentKind(path.basename(filePath), '');
      if (kind) {
        supportedPaths.push(filePath);
        continue;
      }
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
          errors.push(`目标不是文件：${filePath}`);
          continue;
        }
        addRuntimeAllowedFile(filePath);
        unsupportedPaths.push(filePath);
      } catch {
        errors.push(`文件不存在或无法访问：${filePath}`);
      }
    }

    // 单个支持类型文件失败（超限、读取失败等）只记入 errors，不拖垮整批
    const settled = await Promise.allSettled(supportedPaths.map((filePath) => buildAttachmentFromPath(filePath)));
    for (const item of settled) {
      if (item.status === 'fulfilled') {
        attachments.push(item.value);
      } else {
        errors.push(item.reason instanceof Error ? item.reason.message : String(item.reason));
      }
    }

    return { attachments, unsupportedPaths, errors };
  });

  ipcMain.handle(
    'attachment:import-image',
    async (_event, imageBuffer: ArrayBuffer, fileName: string, mimeType: string): Promise<ImportedImageResult> => {
      const kind = inferAttachmentKind(fileName, mimeType);
      if (kind !== 'image') {
        throw new Error('仅支持导入图片类型到粘贴附件。');
      }

      const buffer = Buffer.from(imageBuffer);
      if (buffer.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
        throw new Error('图片超过大小限制（10MB）。');
      }

      await ensurePasteTempDirectory();
      const extension = path.extname(fileName) || '.png';
      const targetPath = path.join(pasteTempDirectory, `paste-${Date.now()}-${crypto.randomUUID()}${extension}`);
      await fs.writeFile(targetPath, buffer);

      return {
        localPath: targetPath,
        size: buffer.byteLength,
      };
    },
  );

  ipcMain.handle('attachment:open-path', async (_event, targetPath: string): Promise<void> => {
    const result = await openPath(targetPath);
    if (!result.ok) {
      throw new Error(result.error || '打开附件失败。');
    }
  });

  ipcMain.handle('attachment:reveal-in-folder', async (_event, targetPath: string): Promise<void> => {
    // 只在文件管理器里定位文件，不执行/打开文件本身，但仍要求路径在允许目录内
    await assertWithinAllowedPaths(targetPath);
    shell.showItemInFolder(targetPath);
  });

  ipcMain.handle(
    'attachment:read-data-url',
    async (_event, targetPath: string, mimeType: string): Promise<string> => {
      // 该通道把任意路径的文件内容以 data URL 返回给 renderer，必须限定在
      // 允许目录内的图片文件，否则等于向渲染层开放任意文件读取。
      const resolvedPath = await assertWithinAllowedPaths(targetPath);
      const extension = path.extname(resolvedPath).toLowerCase();

      if (!imageExtensions.has(extension)) {
        throw new Error('仅支持读取图片类型附件。');
      }

      const stat = await fs.stat(resolvedPath);

      if (!stat.isFile()) {
        throw new Error('目标路径不是文件。');
      }

      if (stat.size > MAX_ATTACHMENT_SIZE_BYTES) {
        throw new Error(`图片超过大小限制（${MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024}MB）。`);
      }

      const buffer = await fs.readFile(resolvedPath);
      // .svg 必须用 image/svg+xml；历史附件可能存成非法的 image/svg，这里按扩展名强制纠正，避免 <img> 无法解码
      const resolvedMime = extension === '.svg'
        ? 'image/svg+xml'
        : mimeType?.startsWith('image/')
          ? mimeType
          : 'image/png';
      return `data:${resolvedMime};base64,${buffer.toString('base64')}`;
    },
  );

  ipcMain.handle(
    'attachment:persist',
    async (_event, conversationId: string, attachments: PendingAttachmentInput[]): Promise<PersistedAttachmentResult[]> => {
      await ensureAttachmentConstraints(attachments);
      if (attachments.length === 0) {
        return [];
      }

      const conversationDirectory = conversationService.getConversationDirectoryPath(conversationId);
      if (!conversationDirectory) {
        throw new Error('未找到对应会话目录，无法保存附件。');
      }

      const attachmentsDirectory = path.join(conversationDirectory, 'attachments');
      await fs.mkdir(attachmentsDirectory, { recursive: true });

      const persisted: PersistedAttachmentResult[] = [];
      for (const attachment of attachments) {
        addRuntimeAllowedFile(attachment.localPath);
        const safeFileName = sanitizeStoredFileName(`${attachment.meta.id}-${attachment.meta.originalName}`);
        const storedPath = path.join(attachmentsDirectory, safeFileName);
        await fs.copyFile(attachment.localPath, storedPath);
        persisted.push({
          storedPath,
          meta: {
            ...attachment.meta,
            fileName: safeFileName,
            kind: inferAttachmentKind(attachment.meta.originalName, attachment.meta.mimeType) ?? attachment.meta.kind,
          },
        });
      }

      await fs.writeFile(
        path.join(conversationDirectory, 'attachments-meta.json'),
        `${JSON.stringify(persisted.map((item) => item.meta), null, 2)}\n`,
        'utf8',
      );

      return persisted;
    },
  );
}
