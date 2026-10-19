import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { buildDocxBuffer, buildPdfBuffer, describeDocumentBlockSchemaError, documentBlocksSchema, type DocumentBlock } from './document-utils';

const sampleBlocks: DocumentBlock[] = [
  { type: 'heading', text: '调研结论', level: 1 },
  { type: 'paragraph', text: '本报告基于多轮证据核验。' },
  { type: 'bullet', text: '优先选择字标注模型' },
  {
    type: 'table',
    rows: [
      ['方法', 'OOV 能力'],
      ['词典最大匹配', '无'],
      ['字标注 CRF', '强'],
    ],
  },
];

test('documentBlocksSchema 接受合法块并给 heading 补默认级别', () => {
  const parsed = documentBlocksSchema.parse([
    { type: 'heading', text: '标题' },
    { type: 'paragraph', text: '正文' },
    { type: 'bullet', text: '要点' },
    { type: 'table', rows: [['a', 'b'], ['1', '2']] },
  ]);

  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].type, 'heading');
  assert.equal(parsed[0].level, 1);
});

test('documentBlocksSchema 拒绝超量块与非法块', () => {
  const tooMany = Array.from({ length: 501 }, () => ({ type: 'paragraph', text: 'x' }));
  assert.throws(() => documentBlocksSchema.parse(tooMany));

  assert.throws(() => documentBlocksSchema.parse([{ type: 'heading', text: 't', level: 4 }]));
  assert.throws(() => documentBlocksSchema.parse([{ type: 'table', rows: [[]] }]));
  assert.throws(() => documentBlocksSchema.parse([{ type: 'unknown', text: 'x' }]));
});

test('describeDocumentBlockSchemaError 输出位置与原因', () => {
  try {
    documentBlocksSchema.parse([{ type: 'table', rows: [['a'], []] }]);
    assert.fail('应当抛出 ZodError');
  } catch (error) {
    const message = describeDocumentBlockSchemaError(error as never);
    assert.match(message, /blocks 参数不合法/);
    assert.match(message, /0\.rows\.1/);
  }
});

test('buildDocxBuffer 生成包含正文的 docx 包', async () => {
  const buffer = await buildDocxBuffer([...sampleBlocks]);
  assert.ok(buffer.length > 1000);

  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  assert.ok(documentXml, 'word/document.xml 应存在');
  assert.match(documentXml, /调研结论/);
  assert.match(documentXml, /字标注 CRF/);
});

test('buildPdfBuffer 生成以 %PDF 开头的中文文档', async () => {
  // 依赖本机存在 CJK 字体（Windows 黑体 / macOS 苹方），缺失时生成器会显式报错
  const buffer = await buildPdfBuffer([...sampleBlocks]);
  assert.ok(buffer.length > 500);
  assert.equal(buffer.subarray(0, 5).toString('latin1'), '%PDF-');
});
