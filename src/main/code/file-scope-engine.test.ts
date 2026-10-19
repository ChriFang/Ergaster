import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  countMatchesInScope,
  createProjectScope,
  globInScope,
  grepInScope,
  listDirInScope,
  readFileInScope,
} from './file-scope-engine';
import { createIgnoreMatcher, defaultIgnoredDirectories, type FileScope } from './code-tools-utils';

const signal = new AbortController().signal;

/** 测试用的 allowedPaths 风格 scope：根内任意子路径放行、根外抛错；展示用相对根路径。 */
function createTestScope(root: string): FileScope {
  const normalizedRoot = path.resolve(root);
  const ignoreMatcher = createIgnoreMatcher(
    defaultIgnoredDirectories.map((name) => ({ pattern: name, negated: false, directoryOnly: false, anchored: false })),
  );
  return {
    async resolve(input: string) {
      const candidate = input.trim() === '' || input === '.'
        ? normalizedRoot
        : (path.isAbsolute(input) ? path.resolve(input) : path.resolve(normalizedRoot, input));
      if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${path.sep}`)) {
        throw new Error('目标路径不在允许访问的目录范围内。');
      }
      return candidate;
    },
    relativize(absolutePath: string) {
      const relative = path.relative(normalizedRoot, absolutePath);
      return relative === '' ? absolutePath.split(path.sep).join('/') : relative.split(path.sep).join('/');
    },
    async getIgnoreMatcher() {
      return ignoreMatcher;
    },
  };
}

async function makeFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-scope-'));
  await fs.mkdir(path.join(dir, 'logs'), { recursive: true });
  await fs.mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
  await fs.writeFile(path.join(dir, 'logs', 'a_2026_10_07.txt'), 'playing url: yrts://x\nstop task 1\nplaying url: http://y\n', 'utf8');
  await fs.writeFile(path.join(dir, 'logs', 'b_2026_10_08.txt'), 'nothing here\nplaying url: yrts://z\n', 'utf8');
  await fs.writeFile(path.join(dir, 'readme.md'), 'line1\nline2\nline3\nline4\nline5\n', 'utf8');
  await fs.writeFile(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'playing url: should be ignored\n', 'utf8');
  return dir;
}

test('globInScope 递归命中并排除 node_modules', async () => {
  const dir = await makeFixture();
  try {
    const scope = createTestScope(dir);
    const result = await globInScope(scope, { pattern: '*.txt', dirPath: '.' }, signal);
    assert.equal(result.ok, true);
    assert.match(result.content, /logs\/a_2026_10_07\.txt/);
    assert.match(result.content, /logs\/b_2026_10_08\.txt/);
    assert.doesNotMatch(result.content, /node_modules/);
    // 结果带文件大小
    assert.match(result.content, /logs\/a_2026_10_07\.txt {2}\(\d+ bytes\)/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('globInScope 支持按名模式', async () => {
  const dir = await makeFixture();
  try {
    const scope = createTestScope(dir);
    const result = await globInScope(scope, { pattern: '*2026_10_07*', dirPath: '.' }, signal);
    assert.match(result.content, /a_2026_10_07\.txt/);
    assert.doesNotMatch(result.content, /b_2026_10_08\.txt/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('grepInScope 搜内容并带命中数', async () => {
  const dir = await makeFixture();
  try {
    const scope = createTestScope(dir);
    const result = await grepInScope(scope, { pattern: 'playing url', dirPath: '.', include: ['*.txt'] }, signal);
    assert.equal(result.ok, true);
    assert.match(result.content, /命中 3 处/);
    assert.doesNotMatch(result.content, /node_modules/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('countMatchesInScope 按文件分组统计', async () => {
  const dir = await makeFixture();
  try {
    const scope = createTestScope(dir);
    const result = await countMatchesInScope(scope, { pattern: 'playing url', dirPath: '.', include: ['*.txt'] }, signal);
    assert.equal(result.ok, true);
    assert.match(result.content, /总命中 3 行，分布在 2 个文件/);
    // 命中更多的文件排在前
    assert.match(result.content, /2\tlogs\/a_2026_10_07\.txt/);
    assert.match(result.content, /1\tlogs\/b_2026_10_08\.txt/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('readFileInScope 分页读取并提示下一页', async () => {
  const dir = await makeFixture();
  try {
    const scope = createTestScope(dir);
    const page1 = await readFileInScope(scope, { filePath: 'readme.md', startLine: 1, maxLines: 2 }, signal);
    assert.equal(page1.ok, true);
    assert.match(page1.content, /行范围：1-2/);
    assert.match(page1.content, /startLine=3/);

    const page2 = await readFileInScope(scope, { filePath: 'readme.md', startLine: 3, maxLines: 100 }, signal);
    assert.match(page2.content, /已读到文件末尾/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('readFileInScope recordRead 回调上报新鲜度', async () => {
  const dir = await makeFixture();
  try {
    const scope = createTestScope(dir);
    let recorded: { mtimeMs: number; size: number; fullyRead: boolean } | null = null;
    await readFileInScope(scope, { filePath: 'readme.md' }, signal, {
      recordRead: (_abs, record) => { recorded = record; },
    });
    assert.ok(recorded);
    assert.equal((recorded as { fullyRead: boolean }).fullyRead, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('listDirInScope 递归列目录', async () => {
  const dir = await makeFixture();
  try {
    const scope = createTestScope(dir);
    const result = await listDirInScope(scope, { dirPath: '.', recursive: true }, signal);
    assert.equal(result.ok, true);
    assert.match(result.content, /logs\/a_2026_10_07\.txt/);
    assert.doesNotMatch(result.content, /node_modules/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('scope.resolve 拒绝越界路径', async () => {
  const dir = await makeFixture();
  try {
    const scope = createTestScope(dir);
    const result = await readFileInScope(scope, { filePath: '../outside.txt' }, signal);
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /允许访问/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('createProjectScope 相对化保持工程内路径', () => {
  const scope = createProjectScope(path.resolve('/tmp/proj'));
  assert.equal(scope.relativize(path.resolve('/tmp/proj/src/a.ts')), 'src/a.ts');
});

test('grepInScope 对超限文件不静默跳过而是给出提示', async () => {
  const dir = await makeFixture();
  try {
    // 写一个 2MB 的"大"文件，其中含目标关键字；用 maxFileBytes=1MB 触发跳过
    const big = 'x'.repeat(1024 * 1024) + '\nplaying url: yrts://big\n' + 'y'.repeat(1024 * 1024);
    await fs.writeFile(path.join(dir, 'logs', 'big.txt'), big, 'utf8');
    const scope = createTestScope(dir);
    const result = await grepInScope(
      scope,
      { pattern: 'playing url', dirPath: '.', include: ['big.txt'] },
      signal,
      { maxFileBytes: 1024 * 1024 },
    );
    assert.equal(result.ok, true);
    assert.match(result.content, /超过 1MB 被跳过/);
    assert.match(result.content, /logs\/big\.txt/);
    assert.match(result.content, /read_file 分页读取/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('readFileInScope 流式读取大文件分页正确', async () => {
  const dir = await makeFixture();
  try {
    // 生成一个超过流式阈值（4MB）的多行文件
    const lineCount = 120_000;
    const lines: string[] = [];
    for (let i = 1; i <= lineCount; i += 1) {
      lines.push(`line-${i}-${'padding'.repeat(5)}`);
    }
    await fs.writeFile(path.join(dir, 'huge.log'), lines.join('\n'), 'utf8');
    const scope = createTestScope(dir);

    const page = await readFileInScope(scope, { filePath: 'huge.log', startLine: 100, maxLines: 3 }, signal);
    assert.equal(page.ok, true);
    assert.match(page.content, new RegExp(`共 ${lineCount} 行`));
    assert.match(page.content, /行范围：100-102/);
    assert.match(page.content, /line-100-/);
    assert.match(page.content, /line-102-/);
    assert.doesNotMatch(page.content, /line-103-/);
    assert.match(page.content, /startLine=103/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
