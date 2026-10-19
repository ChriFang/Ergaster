import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAllowedUrl,
  assertNoSsrf,
  isAllowedHost,
  isGithubHost,
  isTextFile,
  resolveSkillSource,
  resolveZipSkillBase,
  sanitizeZipEntryPath,
} from './skill-source';

test('resolveSkillSource 解析 GitHub 仓库根为 HEAD', () => {
  const r = resolveSkillSource('https://github.com/owner/repo');
  assert.equal(r.kind, 'github');
  if (r.kind === 'github') {
    assert.equal(r.owner, 'owner');
    assert.equal(r.repo, 'repo');
    assert.equal(r.ref, 'HEAD');
    assert.equal(r.subdir, '');
  }
});

test('resolveSkillSource 解析 /tree/{ref}/{subdir}', () => {
  const r = resolveSkillSource('https://github.com/owner/repo/tree/main/skills/pdf');
  assert.equal(r.kind, 'github');
  if (r.kind === 'github') {
    assert.equal(r.ref, 'main');
    assert.equal(r.subdir, 'skills/pdf');
  }
});

test('resolveSkillSource 解析 raw SKILL.md', () => {
  const r = resolveSkillSource('https://raw.githubusercontent.com/owner/repo/main/skills/pdf/SKILL.md');
  assert.equal(r.kind, 'raw-md');
});

test('resolveSkillSource 解析 .zip 包（mcp-proxy 永久链接）', () => {
  const r = resolveSkillSource('https://mcp-proxy.baidu-int.com/api/v1/skills/download/permanent/67691825-7087-4feb-822a-8c366a38ecf6/xxx-skill.zip');
  assert.equal(r.kind, 'zip');
  if (r.kind === 'zip') {
    assert.ok(r.url.endsWith('xxx-skill.zip'));
  }
  assert.equal(isAllowedHost('mcp-proxy.baidu-int.com'), true);
});

test('resolveSkillSource 拒绝非白名单域与非 https', () => {
  assert.throws(() => resolveSkillSource('https://evil.example.com/x/SKILL.md'), /白名单/);
  assert.throws(() => resolveSkillSource('http://github.com/owner/repo'), /https/);
  assert.throws(() => resolveSkillSource('https://raw.githubusercontent.com/o/r/main/readme.txt'), /SKILL\.md/);
});

test('assertNoSsrf 拦截内网/环回/元数据地址', () => {
  assert.throws(() => assertNoSsrf('127.0.0.1'), /环回|内网/);
  assert.throws(() => assertNoSsrf('10.1.2.3'), /内网/);
  assert.throws(() => assertNoSsrf('192.168.0.1'), /内网/);
  assert.throws(() => assertNoSsrf('172.16.5.5'), /内网/);
  assert.throws(() => assertNoSsrf('169.254.169.254'), /内网|环回/);
  assert.throws(() => assertNoSsrf('localhost'), /内网/);
  assert.throws(() => assertNoSsrf('::1'), /内网|环回/);
  assert.doesNotThrow(() => assertNoSsrf('github.com'));
});

test('assertAllowedUrl 放行 GitHub、拒绝内网直链', () => {
  assert.ok(assertAllowedUrl('https://codeload.github.com/o/r/zip/HEAD'));
  assert.equal(isAllowedHost('raw.githubusercontent.com'), true);
  assert.equal(isAllowedHost('evil.com'), false);
});

test('isGithubHost 仅认 GitHub 自有域（token 附带范围）', () => {
  assert.equal(isGithubHost('api.github.com'), true);
  assert.equal(isGithubHost('raw.githubusercontent.com'), true);
  assert.equal(isGithubHost('CODELOAD.GITHUB.COM'), true);
  // 白名单内但非 GitHub 域：不得附带 token
  assert.equal(isGithubHost('skills.sh'), false);
  assert.equal(isGithubHost('mcp-proxy.baidu-int.com'), false);
  assert.equal(isGithubHost('evil.com'), false);
});

test('sanitizeZipEntryPath 消毒路径逃逸', () => {
  assert.equal(sanitizeZipEntryPath('a/b/c.txt'), 'a/b/c.txt');
  assert.equal(sanitizeZipEntryPath('a\\b\\c.txt'), 'a/b/c.txt');
  assert.equal(sanitizeZipEntryPath('./a/./b.txt'), 'a/b.txt');
  assert.equal(sanitizeZipEntryPath('../etc/passwd'), null);
  assert.equal(sanitizeZipEntryPath('a/../../b'), null);
  assert.equal(sanitizeZipEntryPath('/abs/path'), null);
  assert.equal(sanitizeZipEntryPath('C:/win/x'), null);
  assert.equal(sanitizeZipEntryPath(''), null);
});

test('isTextFile 按扩展名判定', () => {
  assert.equal(isTextFile('SKILL.md'), true);
  assert.equal(isTextFile('scripts/run.sh'), true);
  assert.equal(isTextFile('assets/logo.png'), false);
  assert.equal(isTextFile('noext'), false);
});

test('resolveZipSkillBase 定位最浅 SKILL.md 根目录', () => {
  assert.equal(resolveZipSkillBase(['SKILL.md', 'scripts/a.sh']), '');
  assert.equal(resolveZipSkillBase(['pkg/SKILL.md', 'pkg/scripts/a.sh']), 'pkg/');
  assert.equal(resolveZipSkillBase(['docs/readme.md']), null);
  assert.equal(resolveZipSkillBase(['a/SKILL.md', 'b/SKILL.md']), null);
});
