import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deriveDownloadFileName,
  downloadToDirectory,
  isHostAllowed,
  parseContentDispositionFileName,
  resolveDownloadApproval,
  resolveRedirectTarget,
  validateDownloadUrl,
} from './download-engine';

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'download-'));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** 按 URL 返回预置响应的假 fetch，便于离线测试重定向与落盘。 */
function createFakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push(url);
    const route = routes[url];
    if (!route) {
      return new Response('not found', { status: 404 });
    }
    return route();
  }) as typeof fetch;
  return { fakeFetch, calls };
}

test('validateDownloadUrl 只允许 http/https 且拦截内网与内嵌凭据', () => {
  assert.equal(validateDownloadUrl('https://files.example.com/a.zip').hostname, 'files.example.com');
  assert.throws(() => validateDownloadUrl('ftp://files.example.com/a.zip'), /http 或 https/);
  assert.throws(() => validateDownloadUrl('file:///C:/a.zip'), /http 或 https/);
  assert.throws(() => validateDownloadUrl('http://127.0.0.1/a.zip'), /内网|环回/);
  assert.throws(() => validateDownloadUrl('http://169.254.169.254/latest'), /内网|环回/);
  assert.throws(() => validateDownloadUrl('http://localhost:8080/a'), /内网/);
  assert.throws(() => validateDownloadUrl('https://user:pass@files.example.com/a'), /账号密码/);
  assert.throws(() => validateDownloadUrl('not a url'), /非法 URL/);
});

test('isHostAllowed 小写精确匹配，不做子域/通配匹配', () => {
  const list = ['files.example.com'];
  assert.equal(isHostAllowed('FILES.example.com', list), true);
  assert.equal(isHostAllowed('cdn.files.example.com', list), false);
  assert.equal(isHostAllowed('example.com', list), false);
  assert.equal(isHostAllowed('files.example.com', undefined), false);
});

test('resolveDownloadApproval：白名单自动、交互确认、无人值守/工作流拒绝、内网拒绝', () => {
  const allowedHosts = ['files.example.com'];
  assert.equal(
    resolveDownloadApproval({ url: 'https://files.example.com/a.zip', allowedHosts, unattended: false, workflow: false }).decision,
    'auto',
  );
  // 白名单内域名在无人值守下也可执行
  assert.equal(
    resolveDownloadApproval({ url: 'https://files.example.com/a.zip', allowedHosts, unattended: true, workflow: false }).decision,
    'auto',
  );
  const confirm = resolveDownloadApproval({ url: 'https://other.example.com/a.zip', allowedHosts, unattended: false, workflow: false });
  assert.equal(confirm.decision, 'confirm');
  assert.equal(confirm.host, 'other.example.com');
  assert.equal(
    resolveDownloadApproval({ url: 'https://other.example.com/a.zip', allowedHosts, unattended: true, workflow: false }).decision,
    'reject',
  );
  assert.equal(
    resolveDownloadApproval({ url: 'https://other.example.com/a.zip', allowedHosts, unattended: false, workflow: true }).decision,
    'reject',
  );
  // 内网地址即使"在白名单"也拒绝
  assert.equal(
    resolveDownloadApproval({ url: 'http://10.0.0.1/a.zip', allowedHosts: ['10.0.0.1'], unattended: false, workflow: false }).decision,
    'reject',
  );
});

test('parseContentDispositionFileName 支持 filename* 与 filename', () => {
  assert.equal(parseContentDispositionFileName("attachment; filename*=UTF-8''%E6%97%A5%E5%BF%97.zip"), '日志.zip');
  assert.equal(parseContentDispositionFileName('attachment; filename="log file.zip"'), 'log file.zip');
  assert.equal(parseContentDispositionFileName('attachment; filename=plain.txt'), 'plain.txt');
  assert.equal(parseContentDispositionFileName('inline'), null);
  assert.equal(parseContentDispositionFileName(null), null);
});

test('deriveDownloadFileName 优先级、清洗与可执行后缀拒绝', () => {
  const url = new URL('https://files.example.com/path/entmobile-android_1.zip?x=1');
  assert.equal(deriveDownloadFileName({ url }), 'entmobile-android_1.zip');
  assert.equal(deriveDownloadFileName({ url, contentDisposition: 'attachment; filename="from-header.zip"' }), 'from-header.zip');
  assert.equal(deriveDownloadFileName({ url, explicit: 'my.log', contentDisposition: 'attachment; filename="x.zip"' }), 'my.log');
  // 目录成分与非法字符被去掉
  assert.equal(deriveDownloadFileName({ url, explicit: '..\\..\\evil:name.txt' }), 'evil_name.txt');
  // URL 无文件名时用默认名
  assert.equal(deriveDownloadFileName({ url: new URL('https://files.example.com/') }), 'download.bin');
  assert.throws(() => deriveDownloadFileName({ url: new URL('https://files.example.com/setup.exe') }), /可执行/);
  assert.throws(() => deriveDownloadFileName({ url, explicit: 'run.ps1' }), /可执行/);
});

test('resolveRedirectTarget：同 host 或白名单 host 放行，其余拒绝', () => {
  const current = new URL('https://files.example.com/a');
  assert.equal(resolveRedirectTarget('/b', current, 'files.example.com', []).toString(), 'https://files.example.com/b');
  assert.equal(
    resolveRedirectTarget('https://cdn.example.org/b', current, 'files.example.com', ['cdn.example.org']).hostname,
    'cdn.example.org',
  );
  assert.throws(() => resolveRedirectTarget('https://evil.example.net/b', current, 'files.example.com', []), /未授权的域名/);
  assert.throws(() => resolveRedirectTarget('http://192.168.1.1/b', current, 'files.example.com', ['192.168.1.1']), /内网|环回/);
});

test('downloadToDirectory 跟随重定向并流式落盘，同名不覆盖', async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, 'log.zip'), 'existing');
    const { fakeFetch, calls } = createFakeFetch({
      'https://files.example.com/start': () => new Response(null, { status: 302, headers: { location: '/real/log.zip' } }),
      'https://files.example.com/real/log.zip': () => new Response('zip-bytes', { status: 200 }),
    });

    const result = await downloadToDirectory({ url: 'https://files.example.com/start', destDir: dir, fetchImpl: fakeFetch });
    assert.deepEqual(calls, ['https://files.example.com/start', 'https://files.example.com/real/log.zip']);
    assert.equal(result.fileName, 'log (2).zip');
    assert.equal(result.bytes, 'zip-bytes'.length);
    assert.equal(await fs.readFile(result.filePath, 'utf8'), 'zip-bytes');
    // 原有同名文件未被覆盖
    assert.equal(await fs.readFile(path.join(dir, 'log.zip'), 'utf8'), 'existing');
    // 临时文件已清理
    const leftovers = (await fs.readdir(dir)).filter((name) => name.includes('ergaster-download'));
    assert.deepEqual(leftovers, []);
  });
});

test('downloadToDirectory 重定向到未授权域名时中止', async () => {
  await withTempDir(async (dir) => {
    const { fakeFetch } = createFakeFetch({
      'https://files.example.com/start': () => new Response(null, { status: 302, headers: { location: 'https://evil.example.net/x.zip' } }),
    });
    await assert.rejects(
      downloadToDirectory({ url: 'https://files.example.com/start', destDir: dir, fetchImpl: fakeFetch }),
      /未授权的域名/,
    );
    assert.deepEqual(await fs.readdir(dir), []);
  });
});

test('downloadToDirectory 超过体积上限时中止并清理临时文件', async () => {
  await withTempDir(async (dir) => {
    const { fakeFetch } = createFakeFetch({
      // 不声明 content-length，迫使流式计数触发上限
      'https://files.example.com/big.log': () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(600));
          controller.enqueue(new Uint8Array(600));
          controller.close();
        },
      }), { status: 200 }),
    });
    await assert.rejects(
      downloadToDirectory({ url: 'https://files.example.com/big.log', destDir: dir, fetchImpl: fakeFetch, maxBytes: 1000 }),
      /体积超过上限/,
    );
    assert.deepEqual(await fs.readdir(dir), []);
  });
});

test('downloadToDirectory 非 2xx 状态报错', async () => {
  await withTempDir(async (dir) => {
    const { fakeFetch } = createFakeFetch({});
    await assert.rejects(
      downloadToDirectory({ url: 'https://files.example.com/missing.zip', destDir: dir, fetchImpl: fakeFetch }),
      /HTTP 404/,
    );
  });
});
