import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  applyExcelCellUpdates,
  buildExcelBuffer,
  decodeCsvBuffer,
  escapeExcelFormulaInjection,
  formatExcelCellValue,
  normalizeExcelRange,
  parseCsvText,
  readCsvBuffer,
  readXlsxBuffer,
  renderMarkdownTable,
  sanitizeExcelSheetName,
  toExcelCellInput,
} from './excel-utils';
import { ensureXlsxExtension, sanitizeFileName } from './tool-helpers';


async function buildWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();

  const first = workbook.addWorksheet('订单');
  first.addRow(['日期', '名称', '金额']);
  first.addRow([new Date(Date.UTC(2026, 0, 15)), '键盘', 199]);
  first.addRow([new Date(Date.UTC(2026, 0, 16)), '鼠标', 99]);
  first.getCell('C4').value = { formula: 'SUM(C2:C3)', result: 298 } as ExcelJS.CellFormulaValue;

  const second = workbook.addWorksheet('备注');
  second.addRow(['说明']);
  second.addRow(['第二个工作表']);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

test('parseCsvText 处理引号内的逗号、换行与转义引号', () => {
  const rows = parseCsvText('a,"b,1","line\nbreak"\r\n"say ""hi""",d,e');

  assert.deepEqual(rows, [
    ['a', 'b,1', 'line\nbreak'],
    ['say "hi"', 'd', 'e'],
  ]);
});

test('decodeCsvBuffer 剥离 UTF-8 BOM', () => {
  const decoded = decodeCsvBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('名称,金额', 'utf8')]));

  assert.equal(decoded.encoding, 'utf-8-bom');
  assert.equal(decoded.text, '名称,金额');
});

test('decodeCsvBuffer 对非法 UTF-8 回退到 GBK', () => {
  // GBK 编码的「名称」
  const decoded = decodeCsvBuffer(Buffer.from([0xc3, 0xfb, 0xb3, 0xc6]));

  assert.equal(decoded.encoding, 'gbk');
  assert.equal(decoded.text, '名称');
});

test('formatExcelCellValue 归一化各种单元格类型', () => {
  assert.equal(formatExcelCellValue(null), '');
  assert.equal(formatExcelCellValue(undefined), '');
  assert.equal(formatExcelCellValue(12.5), '12.5');
  assert.equal(formatExcelCellValue(new Date(Date.UTC(2026, 0, 15))), '2026-01-15T00:00:00.000Z');
  assert.equal(formatExcelCellValue({ formula: 'SUM(A1:A2)', result: 42 }), '42');
  assert.equal(formatExcelCellValue({ formula: 'A1/0', result: { error: '#DIV/0!' } }), '#DIV/0!');
  assert.equal(formatExcelCellValue({ error: '#REF!' }), '#REF!');
  assert.equal(formatExcelCellValue({ text: '百度', hyperlink: 'https://www.baidu.com' }), '百度');
  assert.equal(formatExcelCellValue({ richText: [{ text: '加' }, { text: '粗' }] }), '加粗');
});

test('renderMarkdownTable 转义竖线并补齐短行', () => {
  const table = renderMarkdownTable([['a|b', 'c'], ['d']]);

  assert.equal(table, ['| a\\|b | c |', '| --- | --- |', '| d |  |'].join('\n'));
});

test('normalizeExcelRange 收敛越界入参', () => {
  assert.deepEqual(normalizeExcelRange(), { startRow: 1, maxRows: 200 });
  assert.deepEqual(normalizeExcelRange({ startRow: 0, maxRows: 9999 }), { startRow: 1, maxRows: 200 });
  assert.deepEqual(normalizeExcelRange({ startRow: 51, maxRows: 10 }), { startRow: 51, maxRows: 10 });
});

test('readCsvBuffer 分页并给出下一页起始行', () => {
  const csv = ['名称,金额', '键盘,199', '鼠标,99', '显示器,1299'].join('\n');
  const first = readCsvBuffer(Buffer.from(csv, 'utf8'), { maxRows: 2 });

  assert.equal(first.ok, true);
  assert.match(first.content, /\| 名称 \| 金额 \|/);
  assert.match(first.content, /键盘/);
  assert.doesNotMatch(first.content, /显示器/);
  assert.equal((first.data as { totalRows: number }).totalRows, 3);
  assert.equal((first.data as { nextStartRow: number | null }).nextStartRow, 3);

  const second = readCsvBuffer(Buffer.from(csv, 'utf8'), { startRow: 3, maxRows: 2 });

  assert.equal(second.ok, true);
  assert.match(second.content, /显示器/);
  assert.equal((second.data as { nextStartRow: number | null }).nextStartRow, null);
});

test('readCsvBuffer 对空内容返回失败', () => {
  const result = readCsvBuffer(Buffer.from('\n\n', 'utf8'));

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /没有可读取的数据行/);
});

test('readXlsxBuffer 不传 sheetName 时只返回工作表概览', async () => {
  const result = await readXlsxBuffer(await buildWorkbookBuffer());

  assert.equal(result.ok, true);
  assert.equal((result.data as { mode: string }).mode, 'overview');
  assert.match(result.content, /订单/);
  assert.match(result.content, /备注/);
  assert.doesNotMatch(result.content, /键盘/);
  assert.deepEqual(
    (result.data as { sheets: Array<{ name: string }> }).sheets.map((sheet) => sheet.name),
    ['订单', '备注'],
  );
});

test('readXlsxBuffer 按 sheetName 返回数据并统计公式单元格', async () => {
  const result = await readXlsxBuffer(await buildWorkbookBuffer(), { sheetName: '订单' });

  assert.equal(result.ok, true);
  assert.equal((result.data as { mode: string }).mode, 'rows');
  assert.match(result.content, /键盘/);
  assert.match(result.content, /2026-01-15T00:00:00.000Z/);
  assert.match(result.content, /298/);
  assert.equal((result.data as { formulaCellCount: number }).formulaCellCount, 1);
  assert.match(result.content, /公式单元格/);
});

test('readXlsxBuffer 支持按行分页', async () => {
  const buffer = await buildWorkbookBuffer();
  const first = await readXlsxBuffer(buffer, { sheetName: '订单', maxRows: 2 });

  assert.equal(first.ok, true);
  assert.doesNotMatch(first.content, /鼠标/);
  assert.equal((first.data as { nextStartRow: number | null }).nextStartRow, 3);

  const second = await readXlsxBuffer(buffer, { sheetName: '订单', startRow: 3, maxRows: 2 });

  assert.equal(second.ok, true);
  assert.match(second.content, /鼠标/);
  assert.equal((second.data as { nextStartRow: number | null }).nextStartRow, null);
});

test('readXlsxBuffer 对不存在的工作表给出可用列表', async () => {
  const result = await readXlsxBuffer(await buildWorkbookBuffer(), { sheetName: '不存在' });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /不存在名为「不存在」的工作表/);
  assert.match(result.error ?? '', /订单、备注/);
});

test('readXlsxBuffer 对超出总行数的 startRow 返回失败', async () => {
  const result = await readXlsxBuffer(await buildWorkbookBuffer(), { sheetName: '订单', startRow: 999 });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /第 999 行起没有数据/);
});

test('escapeExcelFormulaInjection 给危险前缀加单引号', () => {
  assert.equal(escapeExcelFormulaInjection('=cmd|calc'), "'=cmd|calc");
  assert.equal(escapeExcelFormulaInjection('+1+1'), "'+1+1");
  assert.equal(escapeExcelFormulaInjection('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(escapeExcelFormulaInjection('-cmd'), "'-cmd");
  assert.equal(escapeExcelFormulaInjection('普通文本'), '普通文本');
});

test('toExcelCellInput 把纯数字写成数值且不误伤负数', () => {
  assert.equal(toExcelCellInput('199'), 199);
  assert.equal(toExcelCellInput('-5'), -5);
  assert.equal(toExcelCellInput('12.5'), 12.5);
  assert.equal(toExcelCellInput('007'), '007');
  assert.equal(toExcelCellInput(''), '');
  assert.equal(toExcelCellInput('=1+1'), "'=1+1");
});

test('sanitizeExcelSheetName 替换非法字符并截断到 31 字符', () => {
  assert.equal(sanitizeExcelSheetName('订单/明细[2026]', 'Sheet1'), '订单_明细_2026_');
  assert.equal(sanitizeExcelSheetName('   ', 'Sheet1'), 'Sheet1');
  assert.equal(sanitizeExcelSheetName('a'.repeat(40), 'Sheet1').length, 31);
});

test('createExcelDraft 的文件名处理不会逃出草稿目录', () => {
  assert.equal(ensureXlsxExtension(sanitizeFileName('../../evil')), '.._.._evil.xlsx');
  assert.equal(ensureXlsxExtension(sanitizeFileName('报表.xlsx')), '报表.xlsx');
});

test('buildExcelBuffer 生成的文件可被 readXlsxBuffer 读回', async () => {
  const buffer = await buildExcelBuffer([
    { name: '订单', rows: [['名称', '金额'], ['键盘', '199'], ['=cmd|calc', '-5']] },
    { name: '备注', rows: [['说明'], ['第二个工作表']] },
  ]);

  const overview = await readXlsxBuffer(buffer);
  assert.equal(overview.ok, true);
  assert.deepEqual(
    (overview.data as { sheets: Array<{ name: string }> }).sheets.map((sheet) => sheet.name),
    ['订单', '备注'],
  );

  const rows = await readXlsxBuffer(buffer, { sheetName: '订单' });
  assert.equal(rows.ok, true);
  assert.match(rows.content, /\| 名称 \| 金额 \|/);
  assert.match(rows.content, /\| 键盘 \| 199 \|/);
  assert.match(rows.content, /'=cmd\\\|calc/);
  assert.match(rows.content, /-5/);
});

test('buildExcelBuffer 对重复工作表名去重', async () => {
  const buffer = await buildExcelBuffer([
    { name: '数据', rows: [['a']] },
    { name: '数据', rows: [['b']] },
  ]);

  const overview = await readXlsxBuffer(buffer);

  assert.deepEqual(
    (overview.data as { sheets: Array<{ name: string }> }).sheets.map((sheet) => sheet.name),
    ['数据', '数据_2'],
  );
});

test('applyExcelCellUpdates 改指定单元格并保留其余内容', async () => {
  const result = await applyExcelCellUpdates(await buildWorkbookBuffer(), '订单', [
    { cell: 'b2', value: '机械键盘' },
    { cell: 'C2', value: '299' },
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.sheetName, '订单');
  assert.deepEqual(result.applied, [
    { cell: 'B2', before: '键盘', after: '机械键盘' },
    { cell: 'C2', before: '199', after: '299' },
  ]);

  const rows = await readXlsxBuffer(result.buffer, { sheetName: '订单' });
  assert.match(rows.content, /机械键盘/);
  assert.match(rows.content, /299/);
  assert.doesNotMatch(rows.content, /键盘 \| 199/);
  assert.match(rows.content, /鼠标/);
});

test('applyExcelCellUpdates 对新值同样做公式注入转义', async () => {
  const result = await applyExcelCellUpdates(await buildWorkbookBuffer(), '订单', [
    { cell: 'B2', value: '=cmd|calc' },
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.applied[0].after, "'=cmd|calc");
});

test('applyExcelCellUpdates 省略工作表名时取第一个工作表', async () => {
  const result = await applyExcelCellUpdates(await buildWorkbookBuffer(), '', [{ cell: 'A1', value: '日期时间' }]);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.sheetName, '订单');
});

test('applyExcelCellUpdates 拒绝非法单元格引用、重复单元格与空修改', async () => {
  const buffer = await buildWorkbookBuffer();

  const invalid = await applyExcelCellUpdates(buffer, '订单', [{ cell: '1A', value: 'x' }]);
  assert.equal(invalid.ok, false);
  assert.match(invalid.ok ? '' : invalid.error, /不合法/);

  const duplicated = await applyExcelCellUpdates(buffer, '订单', [
    { cell: 'A1', value: 'x' },
    { cell: 'a1', value: 'y' },
  ]);
  assert.equal(duplicated.ok, false);
  assert.match(duplicated.ok ? '' : duplicated.error, /重复指定/);

  const empty = await applyExcelCellUpdates(buffer, '订单', []);
  assert.equal(empty.ok, false);
  assert.match(empty.ok ? '' : empty.error, /至少需要一条/);
});

test('applyExcelCellUpdates 对不存在的工作表给出可用列表', async () => {
  const result = await applyExcelCellUpdates(await buildWorkbookBuffer(), '不存在', [{ cell: 'A1', value: 'x' }]);

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /订单、备注/);
});


