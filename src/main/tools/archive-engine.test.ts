import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { extractZipToDir, normalizeArchiveEntryPath } from './archive-engine';

const signal = new AbortController().signal;

async function makeZip(entries: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-'));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('extractZipToDir 正常解压并保留目录结构', async () => {
  await withTempDir(async (dir) => {
    const zipPath = path.join(dir, 'a.zip');
    await fs.writeFile(zipPath, await makeZip({
      'root.txt': 'hello',
      'sub/child.txt': 'world',
    }));
    const dest = path.join(dir, 'out');
    await fs.mkdir(dest, { recursive: true });

    const result = await extractZipToDir(zipPath, dest, signal);
    assert.equal(result.ok, true);
    assert.match(result.content, /已解压 2 个文件/);
    assert.equal(await fs.readFile(path.join(dest, 'root.txt'), 'utf8'), 'hello');
    assert.equal(await fs.readFile(path.join(dest, 'sub', 'child.txt'), 'utf8'), 'world');
  });
});

test('extractZipToDir 不会把文件写到目标目录之外', async () => {
  await withTempDir(async (dir) => {
    const zipPath = path.join(dir, 'evil.zip');
    // JSZip 会规范化条目名；无论是否被规范化，结果都不得逃出 dest
    const zip = new JSZip();
    zip.file('../escape.txt', 'pwned');
    zip.file('sub/../../escape2.txt', 'pwned2');
    await fs.writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
    const dest = path.join(dir, 'out');
    await fs.mkdir(dest, { recursive: true });

    const result = await extractZipToDir(zipPath, dest, signal);
    // 要么被判路径逃逸中止，要么被规范化后安全落在 dest 内；两种都不得写到 dest 之外
    assert.equal(await pathExists(path.join(dir, 'escape.txt')), false);
    assert.equal(await pathExists(path.join(dir, 'escape2.txt')), false);
    if (!result.ok) {
      assert.match(result.error ?? '', /路径逃逸|超出目标目录范围/);
    }
  });
});

test('extractZipToDir 绝对路径条目不逃出目标目录', async () => {
  await withTempDir(async (dir) => {
    const zipPath = path.join(dir, 'abs.zip');
    const zip = new JSZip();
    zip.file('/etc/evil.txt', 'x');
    await fs.writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
    const dest = path.join(dir, 'out');
    await fs.mkdir(dest, { recursive: true });

    const result = await extractZipToDir(zipPath, dest, signal);
    assert.equal(await pathExists('/etc/evil.txt'), false);
    if (!result.ok) {
      assert.match(result.error ?? '', /路径逃逸|超出目标目录范围/);
    }
  });
});

test('normalizeArchiveEntryPath 处理 Windows 非法字符、末尾点空格与保留名', () => {
  assert.equal(
    normalizeArchiveEntryPath('com.yy.yyvoicetool:FileTransferProcess__pid_1.txt'),
    'com.yy.yyvoicetool_FileTransferProcess__pid_1.txt',
  );
  assert.equal(normalizeArchiveEntryPath('a<b>|c?d*e".txt'), 'a_b__c_d_e_.txt');
  assert.equal(normalizeArchiveEntryPath('dir. /file. '), 'dir/file');
  assert.equal(normalizeArchiveEntryPath('CON'), '_CON');
  assert.equal(normalizeArchiveEntryPath('logs/nul.txt'), 'logs/_nul.txt');
  assert.equal(normalizeArchiveEntryPath('logs/console.txt'), 'logs/console.txt');
});

test('extractZipToDir 含冒号的条目改名落盘并报告，重名追加序号', async () => {
  await withTempDir(async (dir) => {
    const zipPath = path.join(dir, 'colon.zip');
    await fs.writeFile(zipPath, await makeZip({
      'app:proc_1.txt': 'one',
      'app_proc_1.txt': 'two',
      'normal.txt': 'three',
    }));
    const dest = path.join(dir, 'out');
    await fs.mkdir(dest, { recursive: true });

    const result = await extractZipToDir(zipPath, dest, signal);
    assert.equal(result.ok, true, result.error);
    assert.match(result.content, /已解压 3 个文件/);
    assert.match(result.content, /已改名落盘/);
    assert.match(result.content, /app:proc_1\.txt → app_proc_1\.txt/);

    const files = (await fs.readdir(dest)).sort();
    assert.deepEqual(files, ['app_proc_1.txt', 'app_proc_1~2.txt', 'normal.txt']);
    const contents = new Set([
      await fs.readFile(path.join(dest, 'app_proc_1.txt'), 'utf8'),
      await fs.readFile(path.join(dest, 'app_proc_1~2.txt'), 'utf8'),
    ]);
    assert.deepEqual(contents, new Set(['one', 'two']));
  });
});

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
