import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiffStats, buildUnifiedDiff, maxDiffLines } from './code-diff';

test('buildUnifiedDiff 输出带行号的 hunk 与增删前缀', () => {
  const oldText = 'a\nb\nc\n';
  const newText = 'a\nB\nc\n';
  const diff = buildUnifiedDiff('src/a.ts', oldText, newText);

  assert.equal(diff.split('\n')[0], '--- src/a.ts');
  assert.equal(diff.split('\n')[1], '+++ src/a.ts');
  assert.match(diff, /@@ -1,3 \+1,3 @@/);
  assert.match(diff, /^-b$/m);
  assert.match(diff, /^\+B$/m);
  assert.match(diff, /^ a$/m);
});

test('buildUnifiedDiff 新建文件时全部是新增行', () => {
  const diff = buildUnifiedDiff('src/new.ts', '', 'x\ny\n');
  assert.match(diff, /@@ -1,0 \+1,2 @@/);
  assert.match(diff, /^\+x$/m);
  assert.match(diff, /^\+y$/m);
});

test('buildUnifiedDiff 内容相同时明确说明无变化', () => {
  assert.match(buildUnifiedDiff('a.ts', 'same\n', 'same\n'), /内容无变化/);
});

test('buildUnifiedDiff 相隔较远的改动拆成多个 hunk', () => {
  const oldLines = Array.from({ length: 40 }, (_, index) => `line${index + 1}`);
  const newLines = [...oldLines];
  newLines[1] = 'changed-2';
  newLines[35] = 'changed-36';

  const diff = buildUnifiedDiff('a.ts', `${oldLines.join('\n')}\n`, `${newLines.join('\n')}\n`);
  assert.equal((diff.match(/^@@ /gm) ?? []).length, 2);
});

test('buildUnifiedDiff 超大文件退化为概要而不是拒绝输出', () => {
  const oldText = `${Array.from({ length: maxDiffLines + 1 }, (_, index) => `l${index}`).join('\n')}\n`;
  const diff = buildUnifiedDiff('big.ts', oldText, 'small\n');
  assert.match(diff, /未生成逐行 diff/);
});

test('buildDiffStats 统计增删行数', () => {
  assert.deepEqual(buildDiffStats('a\nb\n', 'a\nB\nc\n'), { added: 2, removed: 1 });
  assert.deepEqual(buildDiffStats('', 'a\nb\n'), { added: 2, removed: 0 });
  assert.deepEqual(buildDiffStats('a\n', 'a\n'), { added: 0, removed: 0 });
});
