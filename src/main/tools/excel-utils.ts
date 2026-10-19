import { truncateText } from './tool-helpers';
import type { ToolResult } from '../../shared/tools';

export const maxExcelExtractPreviewLength = 12000;
export const maxExcelRowsPerSheet = 200;
export const maxExcelColumnsPerSheet = 50;
export const maxExcelFileSizeBytes = 10 * 1024 * 1024;
export const excelReadableExtensions = new Set(['.xlsx', '.xlsm', '.csv']);
export const excelUpdatableExtensions = new Set(['.xlsx']);
export const maxExcelSheetNameLength = 31;

const excelInvalidSheetNameChars = /[\\/*?:[\]]/g;
const excelFormulaInjectionPrefix = /^[=+\-@\t\r]/;
const excelPlainNumberPattern = /^-?(0|[1-9]\d*)(\.\d+)?$/;


export type ExcelExtractOptions = {
  sheetName?: string;
  startRow?: number;
  maxRows?: number;
};

export function normalizeExcelRange(options?: ExcelExtractOptions) {
  return {
    startRow: Math.max(Math.trunc(options?.startRow ?? 1), 1),
    maxRows: Math.min(Math.max(Math.trunc(options?.maxRows ?? maxExcelRowsPerSheet), 1), maxExcelRowsPerSheet),
  };
}

export function decodeCsvBuffer(buffer: Buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf-8-bom' };
  }

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' };
  } catch {
    try {
      return { text: new TextDecoder('gbk').decode(buffer), encoding: 'gbk' };
    } catch {
      return { text: buffer.toString('utf8'), encoding: 'utf-8-lossy' };
    }
  }
}

export function parseCsvText(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char !== '"') {
        field += char;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = false;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function formatExcelCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => String((part as { text?: unknown }).text ?? '')).join('');
    }

    if ('error' in record) {
      return String(record.error ?? '');
    }

    if ('formula' in record || 'sharedFormula' in record) {
      return formatExcelCellValue(record.result);
    }

    if ('text' in record) {
      return String(record.text ?? '');
    }

    return JSON.stringify(value);
  }

  return String(value);
}

export function renderMarkdownTable(rows: string[][]) {
  if (rows.length === 0) {
    return '';
  }

  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => {
    const cells = [...row];
    while (cells.length < width) {
      cells.push('');
    }
    return cells.map((cell) => cell.replace(/\|/g, '\\|').replace(/\r?\n/g, ' '));
  });

  const [header, ...body] = normalized;
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];

  for (const row of body) {
    lines.push(`| ${row.join(' | ')} |`);
  }

  return lines.join('\n');
}

function countMergedRanges(worksheet: unknown) {
  const merges = (worksheet as { _merges?: Record<string, unknown> })._merges;
  return merges ? Object.keys(merges).length : 0;
}

export function escapeExcelFormulaInjection(value: string) {
  return excelFormulaInjectionPrefix.test(value) ? `'${value}` : value;
}

export function toExcelCellInput(value: string): string | number {
  if (value === '') {
    return '';
  }

  if (excelPlainNumberPattern.test(value)) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return escapeExcelFormulaInjection(value);
}

export function sanitizeExcelSheetName(name: string, fallback: string) {
  const cleaned = name.replace(excelInvalidSheetNameChars, '_').trim().slice(0, maxExcelSheetNameLength);
  return cleaned || fallback;
}

export type ExcelDraftSheet = {
  name: string;
  rows: string[][];
};

export const maxExcelCellUpdates = 200;

const excelCellReferencePattern = /^[A-Z]{1,3}[1-9]\d{0,6}$/;

type WorksheetLike = { name: string };

function findWorksheetByName<T extends WorksheetLike>(worksheets: T[], requestedName: string) {
  return worksheets.find((item) => item.name === requestedName)
    ?? worksheets.find((item) => item.name.toLowerCase() === requestedName.toLowerCase());
}


export async function buildExcelBuffer(sheets: ExcelDraftSheet[]) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();

  sheets.forEach((sheet, sheetIndex) => {
    const fallbackName = `Sheet${sheetIndex + 1}`;
    const baseName = sanitizeExcelSheetName(sheet.name, fallbackName);
    let name = baseName;
    let suffix = 2;

    while (usedNames.has(name.toLowerCase())) {
      const tail = `_${suffix}`;
      name = `${baseName.slice(0, maxExcelSheetNameLength - tail.length)}${tail}`;
      suffix += 1;
    }


    usedNames.add(name.toLowerCase());
    const worksheet = workbook.addWorksheet(name);

    sheet.rows.forEach((row, rowIndex) => {
      const added = worksheet.addRow(row.map((cell) => toExcelCellInput(cell)));

      if (rowIndex === 0) {
        added.font = { bold: true };
      }
    });
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function readCsvBuffer(buffer: Buffer, options?: ExcelExtractOptions): ToolResult {
  const { startRow, maxRows } = normalizeExcelRange(options);
  const decoded = decodeCsvBuffer(buffer);
  const allRows = parseCsvText(decoded.text).filter((row) => row.some((cell) => cell.trim() !== ''));

  if (allRows.length === 0) {
    return {
      ok: false,
      content: '',
      error: 'CSV 文件中没有可读取的数据行。',
      data: { extractor: 'csv', encoding: decoded.encoding },
    };
  }

  const header = allRows[0].slice(0, maxExcelColumnsPerSheet);
  const bodyRows = allRows.slice(1);
  const sliced = bodyRows
    .slice(startRow - 1, startRow - 1 + maxRows)
    .map((row) => row.slice(0, maxExcelColumnsPerSheet));
  const consumed = startRow - 1 + sliced.length;
  const remaining = Math.max(bodyRows.length - consumed, 0);

  const segments = [
    `CSV 文件（编码 ${decoded.encoding}），共 ${bodyRows.length} 行数据 × ${allRows[0].length} 列，当前返回第 ${startRow} 行起的 ${sliced.length} 行。`,
    renderMarkdownTable([header, ...sliced]),
  ];

  if (allRows[0].length > maxExcelColumnsPerSheet) {
    segments.push(`列数超出上限，仅返回前 ${maxExcelColumnsPerSheet} 列。`);
  }

  if (remaining > 0) {
    segments.push(`还有 ${remaining} 行未返回，可传 startRow=${consumed + 1} 继续读取。`);
  }

  const preview = truncateText(segments.join('\n\n'), maxExcelExtractPreviewLength);

  return {
    ok: true,
    content: preview.text,
    data: {
      extractor: 'csv',
      mode: 'rows',
      encoding: decoded.encoding,
      totalRows: bodyRows.length,
      startRow,
      returnedRows: sliced.length,
      nextStartRow: remaining > 0 ? consumed + 1 : null,
      truncated: preview.truncated,
    },
  };
}

export async function readXlsxBuffer(
  buffer: Buffer,
  options?: ExcelExtractOptions,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const { startRow, maxRows } = normalizeExcelRange(options);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  signal?.throwIfAborted();

  const worksheets = workbook.worksheets;

  if (worksheets.length === 0) {
    return {
      ok: false,
      content: '',
      error: '工作簿中没有工作表。',
      data: { extractor: 'exceljs' },
    };
  }

  const requestedSheetName = options?.sheetName?.trim();

  if (!requestedSheetName) {
    const overview = worksheets.map((worksheet, index) => {
      const headerRow = worksheet.getRow(1);
      const columnCount = Math.min(worksheet.columnCount, maxExcelColumnsPerSheet);
      const headerCells: string[] = [];

      for (let column = 1; column <= columnCount; column += 1) {
        headerCells.push(formatExcelCellValue(headerRow.getCell(column).value));
      }

      const headerText = headerCells.some((cell) => cell !== '') ? headerCells.join(' | ') : '（首行为空）';
      return `${index + 1}. ${worksheet.name} — ${worksheet.rowCount} 行 × ${worksheet.columnCount} 列；首行：${headerText}`;
    });

    const preview = truncateText([
      `工作簿共 ${worksheets.length} 个工作表：`,
      overview.join('\n'),
      '需要具体数据时，请再次调用 read_excel 并传入 sheetName（可配合 startRow / maxRows 分页）。',
    ].join('\n\n'), maxExcelExtractPreviewLength);

    return {
      ok: true,
      content: preview.text,
      data: {
        extractor: 'exceljs',
        mode: 'overview',
        sheets: worksheets.map((worksheet) => ({
          name: worksheet.name,
          rowCount: worksheet.rowCount,
          columnCount: worksheet.columnCount,
        })),
        truncated: preview.truncated,
      },
    };
  }

  const worksheet = findWorksheetByName(worksheets, requestedSheetName);

  if (!worksheet) {
    return {
      ok: false,
      content: '',
      error: `工作簿中不存在名为「${requestedSheetName}」的工作表。可用工作表：${worksheets.map((item) => item.name).join('、')}`,
      data: { extractor: 'exceljs', sheets: worksheets.map((item) => item.name) },
    };
  }

  const columnCount = Math.min(worksheet.columnCount, maxExcelColumnsPerSheet);

  if (worksheet.rowCount === 0 || columnCount === 0) {
    return {
      ok: false,
      content: '',
      error: `工作表「${worksheet.name}」中没有可读取的数据。`,
      data: { extractor: 'exceljs', sheetName: worksheet.name },
    };
  }

  if (startRow > worksheet.rowCount) {
    return {
      ok: false,
      content: '',
      error: `工作表「${worksheet.name}」第 ${startRow} 行起没有数据，总行数为 ${worksheet.rowCount}。`,
      data: { extractor: 'exceljs', sheetName: worksheet.name, totalRows: worksheet.rowCount },
    };
  }

  const endRow = Math.min(startRow + maxRows - 1, worksheet.rowCount);
  const tableRows: string[][] = [];
  let formulaCellCount = 0;

  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    signal?.throwIfAborted();
    const row = worksheet.getRow(rowNumber);
    const cells: string[] = [];

    for (let column = 1; column <= columnCount; column += 1) {
      const cellValue = row.getCell(column).value;

      if (cellValue && typeof cellValue === 'object' && 'formula' in cellValue) {
        formulaCellCount += 1;
      }

      cells.push(formatExcelCellValue(cellValue));
    }

    tableRows.push(cells);
  }

  const mergedRangeCount = countMergedRanges(worksheet);
  const remaining = Math.max(worksheet.rowCount - endRow, 0);
  const segments = [
    `工作表「${worksheet.name}」共 ${worksheet.rowCount} 行 × ${worksheet.columnCount} 列，当前返回第 ${startRow}-${endRow} 行。`,
    renderMarkdownTable(tableRows),
  ];

  if (worksheet.columnCount > columnCount) {
    segments.push(`列数超出上限，仅返回前 ${columnCount} 列。`);
  }

  if (remaining > 0) {
    segments.push(`还有 ${remaining} 行未返回，可传 startRow=${endRow + 1} 继续读取。`);
  }

  if (formulaCellCount > 0) {
    segments.push(`本次返回包含 ${formulaCellCount} 个公式单元格，取的是文件保存时的缓存结果，不是重新计算的值。`);
  }

  if (mergedRangeCount > 0) {
    segments.push(`该工作表存在 ${mergedRangeCount} 处合并单元格，合并区域内仅左上角单元格有值，其余显示为空。`);
  }

  const preview = truncateText(segments.join('\n\n'), maxExcelExtractPreviewLength);

  return {
    ok: true,
    content: preview.text,
    data: {
      extractor: 'exceljs',
      mode: 'rows',
      sheetName: worksheet.name,
      totalRows: worksheet.rowCount,
      totalColumns: worksheet.columnCount,
      startRow,
      returnedRows: tableRows.length,
      nextStartRow: remaining > 0 ? endRow + 1 : null,
      formulaCellCount,
      mergedRangeCount,
      truncated: preview.truncated,
    },
  };
}

export type ExcelCellUpdate = {
  cell: string;
  value: string;
};

export type ApplyExcelCellUpdatesResult =
  | {
    ok: true;
    buffer: Buffer;
    sheetName: string;
    applied: Array<{ cell: string; before: string; after: string }>;
  }
  | { ok: false; error: string };

export async function applyExcelCellUpdates(
  buffer: Buffer,
  sheetName: string,
  updates: ExcelCellUpdate[],
  signal?: AbortSignal,
): Promise<ApplyExcelCellUpdatesResult> {
  if (updates.length === 0) {
    return { ok: false, error: '至少需要一条单元格修改。' };
  }

  if (updates.length > maxExcelCellUpdates) {
    return { ok: false, error: `单次最多修改 ${maxExcelCellUpdates} 个单元格，当前传入 ${updates.length} 个。` };
  }

  const normalizedUpdates = updates.map((update) => ({
    cell: update.cell.trim().toUpperCase(),
    value: update.value,
  }));

  const invalidCell = normalizedUpdates.find((update) => !excelCellReferencePattern.test(update.cell));

  if (invalidCell) {
    return { ok: false, error: `单元格引用「${invalidCell.cell}」不合法，应形如 A1、B12、AA100。` };
  }

  const seen = new Set<string>();
  const duplicate = normalizedUpdates.find((update) => {
    if (seen.has(update.cell)) {
      return true;
    }
    seen.add(update.cell);
    return false;
  });

  if (duplicate) {
    return { ok: false, error: `单元格「${duplicate.cell}」被重复指定，请合并为一条修改。` };
  }

  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  signal?.throwIfAborted();

  const requestedSheetName = sheetName.trim();
  const worksheet = requestedSheetName
    ? findWorksheetByName(workbook.worksheets, requestedSheetName)
    : workbook.worksheets[0];

  if (!worksheet) {
    return {
      ok: false,
      error: `工作簿中不存在名为「${requestedSheetName}」的工作表。可用工作表：${workbook.worksheets.map((item) => item.name).join('、')}`,
    };
  }

  const applied: Array<{ cell: string; before: string; after: string }> = [];

  for (const update of normalizedUpdates) {
    signal?.throwIfAborted();
    const cell = worksheet.getCell(update.cell);
    const before = formatExcelCellValue(cell.value);
    cell.value = toExcelCellInput(update.value);
    applied.push({ cell: update.cell, before, after: formatExcelCellValue(cell.value) });
  }

  return {
    ok: true,
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    sheetName: worksheet.name,
    applied,
  };
}

