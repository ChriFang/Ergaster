import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * 文档草稿共享块结构：create_docx_draft / create_pdf_draft 共用同一套参数，
 * 生成器只负责把块翻译成各自格式。
 */
export const documentBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    text: z.string().trim().min(1).max(2000),
    level: z.number().int().min(1).max(3).default(1),
  }),
  z.object({
    type: z.literal('paragraph'),
    text: z.string().trim().min(1).max(8000),
  }),
  z.object({
    type: z.literal('bullet'),
    text: z.string().trim().min(1).max(2000),
  }),
  z.object({
    type: z.literal('table'),
    rows: z.array(z.array(z.string()).min(1).max(30)).min(1).max(200),
  }),
]);

export const documentBlocksSchema = z.array(documentBlockSchema).min(1).max(500);

export type DocumentBlock = z.infer<typeof documentBlockSchema>;

export function describeDocumentBlockSchemaError(error: z.ZodError): string {
  const issue = error.issues[0];
  const location = issue.path.length > 0 ? issue.path.join('.') : 'blocks';
  return `blocks 参数不合法（${location}）：${issue.message}`;
}

/** 表格列宽按最大列数均分，返回每列可用宽度（pt）。 */
function tableColumnWidths(columnCount: number, usableWidth: number) {
  return Array.from({ length: columnCount }, () => usableWidth / columnCount);
}

export async function buildDocxBuffer(blocks: DocumentBlock[]): Promise<Buffer> {
  const { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = await import('docx');

  const headingLevels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];

  const children = blocks.map((block) => {
    switch (block.type) {
      case 'heading':
        return new Paragraph({ text: block.text, heading: headingLevels[block.level - 1] });
      case 'paragraph':
        return new Paragraph({ children: [new TextRun(block.text)] });
      case 'bullet':
        return new Paragraph({ text: block.text, bullet: { level: 0 } });
      case 'table':
        return new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: block.rows.map((cells, rowIndex) => new TableRow({
            tableHeader: rowIndex === 0,
            children: cells.map((cell) => new TableCell({
              children: [new Paragraph({ children: rowIndex === 0 ? [new TextRun({ text: cell, bold: true })] : [new TextRun(cell)] })],
            })),
          })),
        });
    }
  });

  const document = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(document);
  return Buffer.from(buffer);
}

/**
 * 探测可用的 CJK 字体文件。pdfkit 的标准 14 字体不含中文字形，
 * 不内嵌字体直接写中文会产出乱码 PDF，因此找不到字体时必须报错而不是降级。
 */
export function resolveCjkFontPath(): { path: string; postscriptName?: string } {
  const candidates: Array<{ path: string; postscriptName?: string }> = [];
  const windowsFonts = process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : 'C:\\Windows\\Fonts';

  if (process.platform === 'win32') {
    candidates.push(
      { path: path.join(windowsFonts, 'simhei.ttf') },
      { path: path.join(windowsFonts, 'Deng.ttf') },
      { path: path.join(windowsFonts, 'simfang.ttf') },
      { path: path.join(windowsFonts, 'simkai.ttf') },
      { path: path.join(windowsFonts, 'msyh.ttf') },
      { path: path.join(windowsFonts, 'msyh.ttc'), postscriptName: 'MicrosoftYaHei' },
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      { path: '/Library/Fonts/Arial Unicode.ttf' },
      { path: '/System/Library/Fonts/STHeiti Light.ttc', postscriptName: 'STHeitiSC-Light' },
      { path: '/System/Library/Fonts/STHeiti Medium.ttc', postscriptName: 'STHeitiSC-Medium' },
      { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', postscriptName: 'HiraginoSansGB-W3' },
    );
  } else {
    candidates.push(
      { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', postscriptName: 'NotoSansCJKsc-Regular' },
      { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc' },
    );
  }

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate.path).isFile()) {
        return candidate;
      }
    } catch {
      // 继续尝试下一个候选
    }
  }

  throw new Error('未找到可用的中文字体文件，无法生成中文 PDF。请确认系统已安装黑体/微软雅黑（Windows）或苹方（macOS）字体。');
}

export async function buildPdfBuffer(blocks: DocumentBlock[]): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const font = resolveCjkFontPath();

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    // 必须在构造时指定字体，否则 pdfkit 会加载内置 Helvetica（不含中文字形且 afm 资源在打包后缺失）
    font: font.path,
    info: { Title: 'Ergaster Draft' },
  });

  const chunks: Buffer[] = [];
  const failure = new Promise<never>((_resolve, reject) => {
    doc.on('error', reject);
  });
  const completed = new Promise<Buffer>((resolve) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  if (font.postscriptName) {
    doc.font(font.path, font.postscriptName);
  }

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        doc.fontSize(22 - (block.level - 1) * 4).text(block.text);
        doc.moveDown(0.5);
        break;
      }
      case 'paragraph': {
        doc.fontSize(11).text(block.text);
        doc.moveDown(0.4);
        break;
      }
      case 'bullet': {
        doc.fontSize(11).text(`•  ${block.text}`);
        break;
      }
      case 'table': {
        const columnCount = Math.max(...block.rows.map((row) => row.length));
        const columnWidths = tableColumnWidths(columnCount, pageWidth);
        const rowHeight = 18;
        const startY = doc.y;

        doc.fontSize(10);
        block.rows.forEach((row, rowIndex) => {
          const y = startY + rowIndex * rowHeight;
          row.forEach((cell, columnIndex) => {
            const columnWidth = columnWidths[columnIndex];
            const cellX = doc.page.margins.left + columnIndex * columnWidth;
            doc.rect(cellX, y, columnWidth, rowHeight).stroke();
            doc.text(cell, cellX + 3, y + 4, {
              width: columnWidth - 6,
              height: rowHeight - 6,
              lineBreak: false,
            });
          });
        });

        doc.y = startY + block.rows.length * rowHeight;
        doc.x = doc.page.margins.left;
        doc.moveDown(0.5);
        break;
      }
    }
  }

  doc.end();
  return Promise.race([completed, failure]);
}
