import assert from 'node:assert/strict';
import test from 'node:test';
import { appendPathReferences, formatPathReference } from './path-reference';

test('无空白字符的路径原样输出', () => {
  assert.equal(formatPathReference('E:\\downloads\\demo.mp4'), 'E:\\downloads\\demo.mp4');
});

test('含空格的路径自动加引号', () => {
  assert.equal(formatPathReference('E:\\My Videos\\demo file.mp4'), '"E:\\My Videos\\demo file.mp4"');
});

test('多条路径各占一行', () => {
  assert.equal(
    appendPathReferences('', ['E:\\a\\demo.mp4', 'E:\\My Videos\\setup.exe']),
    'E:\\a\\demo.mp4\n"E:\\My Videos\\setup.exe"',
  );
});

test('追加到已有文本时截掉尾部空白并以换行分隔', () => {
  assert.equal(
    appendPathReferences('帮我分析这个视频\n', ['E:\\a\\demo.mp4']),
    '帮我分析这个视频\nE:\\a\\demo.mp4',
  );
  assert.equal(
    appendPathReferences('帮我分析   ', ['E:\\a\\demo.mp4']),
    '帮我分析\nE:\\a\\demo.mp4',
  );
});

test('空路径列表原样返回', () => {
  assert.equal(appendPathReferences('原有内容', []), '原有内容');
});
