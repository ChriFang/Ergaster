import assert from 'node:assert/strict';
import test from 'node:test';
import { extractMcpResultContent } from './mcp-result-utils';

test('文本块按顺序拼接为 content', () => {
  const { text, images } = extractMcpResultContent({
    content: [
      { type: 'text', text: '第一段' },
      { type: 'text', text: '第二段' },
    ],
  });

  assert.equal(text, '第一段\n第二段');
  assert.deepEqual(images, []);
});

test('image 块转成 data URL，不再 JSON.stringify 成文本', () => {
  const { text, images } = extractMcpResultContent({
    content: [
      { type: 'image', data: 'QUJD', mimeType: 'image/png' },
    ],
  });

  assert.deepEqual(images, ['data:image/png;base64,QUJD']);
  // 文本只剩一条说明，绝不能包含 base64
  assert.match(text, /该工具返回了 1 张图片/);
  assert.equal(text.includes('QUJD'), false);
});

test('image 块缺 mimeType 时默认 image/png，指定时保留原值', () => {
  const { images } = extractMcpResultContent({
    content: [
      // 畸形块（缺 mimeType）按运行时兜底处理，类型上用 never 放行
      { type: 'image', data: 'QQ==' } as never,
      { type: 'image', data: 'Qg==', mimeType: 'image/jpeg' },
    ],
  });

  assert.deepEqual(images, ['data:image/png;base64,QQ==', 'data:image/jpeg;base64,Qg==']);
});

test('文本与图片混排时文本保留、图片单独收集', () => {
  const { text, images } = extractMcpResultContent({
    content: [
      { type: 'text', text: '截图完成' },
      { type: 'image', data: 'QUJD', mimeType: 'image/png' },
    ],
  });

  assert.equal(text, '截图完成\n[该工具返回了 1 张图片，已作为图片内容附带]');
  assert.deepEqual(images, ['data:image/png;base64,QUJD']);
});

test('resource 等其他块保持 JSON 序列化，不丢信息', () => {
  const { text, images } = extractMcpResultContent({
    content: [
      { type: 'text', text: '结果如下' },
      { type: 'resource', resource: { uri: 'file:///tmp/a.txt' } } as never,
    ],
  });

  assert.match(text, /^结果如下\n/);
  assert.match(text, /file:\/\/\/tmp\/a\.txt/);
  assert.deepEqual(images, []);
});

test('空 data 的 image 块按普通块处理，不产生空图片', () => {
  const { text, images } = extractMcpResultContent({
    content: [
      { type: 'image', data: '', mimeType: 'image/png' },
    ],
  });

  assert.deepEqual(images, []);
  // 走 otherBlocks 序列化兜底，不丢失原始结构
  assert.match(text, /\[\{"type":"image"/);
});

test('content 缺失或为空数组时返回空结果', () => {
  assert.deepEqual(extractMcpResultContent({}), { text: '', images: [] });
  assert.deepEqual(extractMcpResultContent({ content: [] }), { text: '', images: [] });
});
