import assert from 'node:assert/strict';
import test from 'node:test';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { messageUrlTransform, toLocalFilePath } from './message-link';

// 直接跑 react-markdown 内部同一条 remark → rehype 管线，取出最终 href。
// 这些用例存在的意义：链接地址在到达 <a> 之前会被 normalizeUri 百分号编码，
// 光看 markdown 原文推断 href 会得出错误结论。
function renderHref(markdown: string) {
  const processor = unified().use(remarkParse).use(remarkRehype);
  const tree = processor.runSync(processor.parse(markdown));
  let href: string | null = null;

  visit(tree, 'element', (node) => {
    if (node.tagName === 'a' && typeof node.properties?.href === 'string') {
      href = node.properties.href;
    }
  });

  return href;
}

test('管线会把 Windows 路径里的反斜杠与中文百分号编码', () => {
  assert.equal(
    renderHref('[打开](C:\\Users\\lin\\Documents\\ErgasterDrafts\\大图URL.txt)'),
    'C:%5CUsers%5Clin%5CDocuments%5CErgasterDrafts%5C%E5%A4%A7%E5%9B%BEURL.txt',
  );
});

test('Windows 路径链接能还原出原始路径', () => {
  const href = renderHref('[打开](C:\\Users\\lin\\Documents\\ErgasterDrafts\\大图URL.txt)');

  assert.ok(href);
  assert.equal(toLocalFilePath(href), 'C:\\Users\\lin\\Documents\\ErgasterDrafts\\大图URL.txt');
  assert.equal(messageUrlTransform(href), href, 'urlTransform 不能把本地路径清成空串');
});

test('尖括号包裹的含空格路径同样能还原', () => {
  const href = renderHref('[打开](<C:\\My Docs\\a b.txt>)');

  assert.ok(href);
  assert.equal(toLocalFilePath(href), 'C:\\My Docs\\a b.txt');
});

test('file:// 链接能还原成盘符路径', () => {
  const href = renderHref('[打开](file:///C:/Users/lin/Documents/ErgasterDrafts/大图URL.txt)');

  assert.ok(href);
  assert.equal(toLocalFilePath(href), 'C:/Users/lin/Documents/ErgasterDrafts/大图URL.txt');
  assert.equal(messageUrlTransform(href), href);
});

test('http 链接不被当成本地路径', () => {
  const href = renderHref('[站点](https://example.com/x?y=1)');

  assert.equal(href, 'https://example.com/x?y=1');
  assert.equal(toLocalFilePath(href ?? ''), '');
});

test('javascript: 协议仍然被默认净化拦掉', () => {
  assert.equal(toLocalFilePath('javascript:alert(1)'), '');
  assert.equal(messageUrlTransform('javascript:alert(1)'), '');
});

test('POSIX 绝对路径按本地路径处理', () => {
  const href = renderHref('[打开](/home/lin/报表.xlsx)');

  assert.ok(href);
  assert.equal(toLocalFilePath(href), '/home/lin/报表.xlsx');
});
