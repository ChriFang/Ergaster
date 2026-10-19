import assert from 'node:assert/strict';
import test from 'node:test';
import { isSvgAttachment } from './attachment';

test('isSvgAttachment 命中 svg mime 与 .svg 后缀（大小写不敏感）', () => {
  assert.equal(isSvgAttachment({ mimeType: 'image/svg+xml', originalName: 'icon.svg' }), true);
  assert.equal(isSvgAttachment({ mimeType: 'application/octet-stream', originalName: 'logo.SVG' }), true);
  assert.equal(isSvgAttachment({ mimeType: 'image/svg+xml', originalName: 'noext' }), true);
});

test('isSvgAttachment 对光栅图与非图片返回 false', () => {
  assert.equal(isSvgAttachment({ mimeType: 'image/png', originalName: 'a.png' }), false);
  assert.equal(isSvgAttachment({ mimeType: 'image/jpeg', originalName: 'b.jpg' }), false);
  assert.equal(isSvgAttachment({ mimeType: 'text/plain', originalName: 'c.txt' }), false);
});
