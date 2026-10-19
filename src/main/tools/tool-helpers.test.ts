import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { clipLogText, createIdleDeadline, decodeImageDraft, ensureXlsxExtension, expandHomePath, getFileExtension, isTimeoutAbort, PREVIEW_IMAGE_EXTENSIONS, PREVIEW_TEXT_EXTENSIONS, resolveChildPath, resolveImagePreviewMime, resolveTextDraftExtension, sanitizeDraftRelativePath, sanitizeFileName, truncateText } from './tool-helpers';

function waitForAbort(signal: AbortSignal, maxWaitMs = 1000) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const keepAlive = setTimeout(resolve, maxWaitMs);
    signal.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      resolve();
    }, { once: true });
  });
}


test('isTimeoutAbort 能区分超时与用户取消', async () => {
  const controller = new AbortController();
  const userCancelled = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
  controller.abort();

  assert.equal(isTimeoutAbort(userCancelled), false, '用户取消不应被当成超时');

  const idle = new AbortController();
  const timedOut = AbortSignal.any([idle.signal, AbortSignal.timeout(5)]);

  // AbortSignal.timeout 内部是 unref 定时器，不会撑住事件循环，
  // 这里显式挂一个 ref 定时器等它触发，否则测试会被判为悬挂。
  await new Promise<void>((resolve) => {
    const keepAlive = setTimeout(resolve, 1000);
    timedOut.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      resolve();
    }, { once: true });
  });

  assert.equal(isTimeoutAbort(timedOut), true, '超时应被识别');
});

test('isTimeoutAbort 对未中断或缺失的信号返回 false', () => {
  assert.equal(isTimeoutAbort(undefined), false);
  assert.equal(isTimeoutAbort(new AbortController().signal), false);
});

test('createIdleDeadline 在空闲超过上限后以 TimeoutError 中断', async () => {
  const outer = new AbortController();
  const deadline = createIdleDeadline({ signal: outer.signal, timeoutMs: 20, timeoutMessage: '模型服务超过 20 毫秒没有返回新数据。' });

  await waitForAbort(deadline.signal);

  assert.equal(deadline.signal.aborted, true);
  assert.equal(isTimeoutAbort(deadline.signal), true);
  assert.equal((deadline.signal.reason as DOMException).message, '模型服务超过 20 毫秒没有返回新数据。');
  deadline.dispose();
});

test('createIdleDeadline 每次 refresh 都会重置空闲计时', async () => {
  const outer = new AbortController();
  const deadline = createIdleDeadline({ signal: outer.signal, timeoutMs: 60, timeoutMessage: 'timeout' });

  // 持续「有新数据」的 200ms 内不应超时，尽管总耗时早已超过 60ms 的空闲上限
  for (let tick = 0; tick < 10; tick += 1) {
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
    deadline.refresh();
    assert.equal(deadline.signal.aborted, false, `第 ${tick + 1} 次 refresh 后不应被中断`);
  }

  // 停止 refresh 后仍应正常超时
  await waitForAbort(deadline.signal);
  assert.equal(isTimeoutAbort(deadline.signal), true);
  deadline.dispose();
});

test('createIdleDeadline 透传用户取消，不会被误判为超时', async () => {
  const outer = new AbortController();
  const deadline = createIdleDeadline({ signal: outer.signal, timeoutMs: 60_000, timeoutMessage: 'timeout' });

  outer.abort();
  await waitForAbort(deadline.signal);

  assert.equal(deadline.signal.aborted, true);
  assert.equal(isTimeoutAbort(deadline.signal), false, '用户取消不应被当成超时');
  deadline.dispose();
});

test('createIdleDeadline 对已中断的外层信号立即中断', () => {
  const outer = new AbortController();
  outer.abort();

  const deadline = createIdleDeadline({ signal: outer.signal, timeoutMs: 60_000, timeoutMessage: 'timeout' });

  assert.equal(deadline.signal.aborted, true);
  assert.equal(isTimeoutAbort(deadline.signal), false);
  deadline.dispose();
});

test('createIdleDeadline 的 refresh 在已中断后是空操作', async () => {
  const outer = new AbortController();
  const deadline = createIdleDeadline({ signal: outer.signal, timeoutMs: 20, timeoutMessage: 'timeout' });

  await waitForAbort(deadline.signal);
  const reasonBefore = deadline.signal.reason;
  deadline.refresh();

  assert.equal(deadline.signal.reason, reasonBefore);
  deadline.dispose();
});

test('truncateText 超长时截断并标记', () => {
  assert.deepEqual(truncateText('abc', 10), { text: 'abc', truncated: false });

  const result = truncateText('abcdef', 3);
  assert.equal(result.truncated, true);
  assert.ok(result.text.startsWith('abc'));
});

test('resolveChildPath 拦截逃出根目录的路径', () => {
  const root = path.join(os.tmpdir(), 'ergaster-helper-test');

  assert.throws(() => resolveChildPath(root, `..${path.sep}outside.txt`), /超出允许目录范围/);
  assert.equal(resolveChildPath(root, 'a.txt'), path.join(root, 'a.txt'));
});

test('sanitizeFileName 与 ensureXlsxExtension 组合后不会带路径分隔符', () => {
  assert.equal(ensureXlsxExtension(sanitizeFileName('..\\..\\evil')), '.._.._evil.xlsx');
});

test('sanitizeDraftRelativePath 保留相对子目录结构', () => {
  assert.equal(sanitizeDraftRelativePath('icons/bot.svg'), 'icons/bot.svg');
  assert.equal(sanitizeDraftRelativePath('a/b/c/报告.docx'), 'a/b/c/报告.docx');
});

test('sanitizeDraftRelativePath 逐段清洗非法字符', () => {
  assert.equal(sanitizeDraftRelativePath('my icons\\game:v2/bot?.svg'), 'my icons/game_v2/bot_.svg');
  assert.equal(sanitizeDraftRelativePath('a*b/c?d/file:name.txt'), 'a_b/c_d/file_name.txt');
});

test('sanitizeDraftRelativePath 丢弃空段与点段，防目录穿越', () => {
  assert.equal(sanitizeDraftRelativePath('/icons//bot.svg'), 'icons/bot.svg');
  assert.equal(sanitizeDraftRelativePath('..\\..\\evil.txt'), 'evil.txt');
  assert.equal(sanitizeDraftRelativePath('./a/./b/../c.txt'), 'a/b/c.txt');
});

test('sanitizeDraftRelativePath 纯文件名原样保留（非法字符仍清洗）', () => {
  assert.equal(sanitizeDraftRelativePath('bot.svg'), 'bot.svg');
  assert.equal(sanitizeDraftRelativePath('my:file.txt'), 'my_file.txt');
});

test('clipLogText 截断超长文本并标注丢弃字符数', () => {
  assert.equal(clipLogText('abc', 10), 'abc');
  assert.equal(clipLogText('abc', 3), 'abc');
  assert.equal(clipLogText('abcdef', 3), 'abc…[已截断 3 字符]');
});

test('resolveTextDraftExtension 白名单后缀原样保留，大小写不敏感', () => {
  assert.equal(resolveTextDraftExtension('报告.md'), '报告.md');
  assert.equal(resolveTextDraftExtension('data.CSV'), 'data.CSV');
  assert.equal(resolveTextDraftExtension('main.ts'), 'main.ts');
});

test('resolveTextDraftExtension 无后缀补 .txt', () => {
  assert.equal(resolveTextDraftExtension('草稿'), '草稿.txt');
  assert.equal(resolveTextDraftExtension('.gitignore'), '.gitignore.txt');
});

test('resolveTextDraftExtension 拒绝脚本/可执行后缀', () => {
  assert.throws(() => resolveTextDraftExtension('run.bat'), /脚本\/可执行/);
  assert.throws(() => resolveTextDraftExtension('payload.JS'), /脚本\/可执行/);
  assert.throws(() => resolveTextDraftExtension('tool.ps1'), /脚本\/可执行/);
});

test('resolveTextDraftExtension 对图片/office 后缀给出改用指引', () => {
  assert.throws(() => resolveTextDraftExtension('pic.png'), /create_image_draft/);
  assert.throws(() => resolveTextDraftExtension('表.xlsx'), /create_excel_draft/);
  assert.throws(() => resolveTextDraftExtension('文档.docx'), /create_docx_draft/);
  assert.throws(() => resolveTextDraftExtension('说明.pdf'), /create_pdf_draft/);
});

test('resolveTextDraftExtension 未知后缀报错并列出可用列表', () => {
  assert.throws(() => resolveTextDraftExtension('file.xyz'), /不支持的草稿后缀 .xyz/);
});

test('decodeImageDraft 接受合法 PNG（含 data URL 前缀与换行空白）', () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const base64 = bytes.toString('base64');
  assert.deepEqual(decodeImageDraft(base64, '图.png').buffer, bytes);
  assert.deepEqual(decodeImageDraft(`data:image/png;base64,${base64}`, '图.png').buffer, bytes);
  assert.deepEqual(decodeImageDraft(base64.slice(0, 8) + '\n' + base64.slice(8), '图.png').buffer, bytes);
});

test('decodeImageDraft 校验后缀与魔数一致性', () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.throws(() => decodeImageDraft(pngBytes.toString('base64'), '伪装.jpg'), /魔数校验失败/);
  assert.throws(() => decodeImageDraft(pngBytes.toString('base64'), 'readme.txt'), /图片草稿仅支持后缀/);
});

test('decodeImageDraft 拒绝非 base64 与超限图片', () => {
  assert.throws(() => decodeImageDraft('不是base64!!', 'a.png'), /合法的 base64/);
  const oversized = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(10 * 1024 * 1024),
  ]).toString('base64');
  assert.throws(() => decodeImageDraft(oversized, 'big.png'), /大小上限/);
});

test('resolveImagePreviewMime 覆盖图片预览后缀并拒绝未知后缀', () => {
  assert.equal(resolveImagePreviewMime('.png'), 'image/png');
  assert.equal(resolveImagePreviewMime('.JPG'), 'image/jpeg');
  assert.equal(resolveImagePreviewMime('.svg'), 'image/svg+xml');
  assert.equal(resolveImagePreviewMime('.txt'), null);
  assert.equal(resolveImagePreviewMime('.docx'), null);
});

test('svg 属于图片预览但不属于文本预览', () => {
  assert.equal(PREVIEW_IMAGE_EXTENSIONS.has('.svg'), true);
  assert.equal(PREVIEW_TEXT_EXTENSIONS.has('.svg'), false);
  assert.equal(PREVIEW_TEXT_EXTENSIONS.has('.md'), true);
  assert.equal(PREVIEW_TEXT_EXTENSIONS.has('.py'), true);
});

test('getFileExtension 处理盘符路径与无后缀文件', () => {
  assert.equal(getFileExtension('C:\\dir\\a.PNG'), '.png');
  assert.equal(getFileExtension('/tmp/README'), '');
  assert.equal(getFileExtension('archive.tar.gz'), '.gz');
});

test('expandHomePath 展开 ~ / ~/ 到家目录', () => {
  assert.equal(expandHomePath('~'), os.homedir());
  assert.equal(expandHomePath('~/Documents/ErgasterDrafts'), path.join(os.homedir(), 'Documents', 'ErgasterDrafts'));
  assert.equal(expandHomePath('~\\Documents'), path.join(os.homedir(), 'Documents'));
});

test('expandHomePath 不动绝对路径、相对路径与他人家目录', () => {
  assert.equal(expandHomePath('/Users/foo/bar'), '/Users/foo/bar');
  assert.equal(expandHomePath('Documents/x'), 'Documents/x');
  assert.equal(expandHomePath('~otheruser/x'), '~otheruser/x');
});

