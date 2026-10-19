import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultConfig, maxToolRounds, minToolRounds, normalizeDownloadHost, resolveCloseBehavior, sanitizeConfig, type AppConfig } from './config';

test('sanitizeConfig 保留合法的关闭行为配置', () => {
  assert.equal(sanitizeConfig({ closeAction: 'minimize' }).closeAction, 'minimize');
  assert.equal(sanitizeConfig({ closeAction: 'exit' }).closeAction, 'exit');
  assert.equal(sanitizeConfig({ closeAction: 'ask' }).closeAction, 'ask');
});

test('sanitizeConfig 非法关闭行为回退默认值', () => {
  const badInput = { closeAction: 'bogus' } as unknown as Partial<AppConfig>;
  assert.equal(sanitizeConfig(badInput).closeAction, defaultConfig.closeAction);
});

test('sanitizeConfig 缺省时关闭行为取默认（每次询问）', () => {
  assert.equal(sanitizeConfig(null).closeAction, 'ask');
});

test('sanitizeConfig memoryEnabled 缺省为 true，布尔值原样保留', () => {
  assert.equal(sanitizeConfig(null).memoryEnabled, true);
  assert.equal(sanitizeConfig({ memoryEnabled: false }).memoryEnabled, false);
  const badInput = { memoryEnabled: 'yes' } as unknown as Partial<AppConfig>;
  assert.equal(sanitizeConfig(badInput).memoryEnabled, defaultConfig.memoryEnabled);
});

test('sanitizeConfig enabledExtensions 缺省为空数组，清洗 trim/去空', () => {
  assert.deepEqual(sanitizeConfig(null).enabledExtensions, []);
  assert.deepEqual(sanitizeConfig({ enabledExtensions: ['mail'] }).enabledExtensions, ['mail']);
  assert.deepEqual(sanitizeConfig({ enabledExtensions: ['  mail  ', ''] }).enabledExtensions, ['mail']);
  const badInput = { enabledExtensions: 'mail' } as unknown as Partial<AppConfig>;
  assert.deepEqual(sanitizeConfig(badInput).enabledExtensions, []);
});

test('sanitizeConfig downloadAllowedHosts 小写去重并丢弃非法主机名', () => {
  const config = sanitizeConfig({
    toolSettings: {
      downloadAllowedHosts: [' Files.Example.com ', 'files.example.com', 'https://evil.com', '*.example.com', 'a b.com', '', 'cdn.example.org'],
    },
  });
  assert.deepEqual(config.toolSettings?.downloadAllowedHosts, ['files.example.com', 'cdn.example.org']);
  assert.equal(sanitizeConfig({ toolSettings: {} }).toolSettings?.downloadAllowedHosts, undefined);
});

test('normalizeDownloadHost 只接受纯主机名', () => {
  assert.equal(normalizeDownloadHost('  OSS-CN.aliyuncs.COM '), 'oss-cn.aliyuncs.com');
  assert.equal(normalizeDownloadHost('example.com:8080'), '');
  assert.equal(normalizeDownloadHost('example.com/path'), '');
  assert.equal(normalizeDownloadHost('-bad.com'), '');
});


test('sanitizeConfig 丢弃 rev1 遗留的 trayEnabled 字段', () => {
  const legacyInput = { trayEnabled: false } as unknown as Partial<AppConfig>;
  const config = sanitizeConfig(legacyInput);
  assert.equal('trayEnabled' in config, false);
  assert.equal(config.closeAction, defaultConfig.closeAction);
});

test('sanitizeConfig maxToolRounds 缺省取默认值，越界夹到 [minToolRounds, maxToolRounds]', () => {
  assert.equal(sanitizeConfig(null).maxToolRounds, defaultConfig.maxToolRounds);
  assert.equal(defaultConfig.maxToolRounds, 256);
  // 越界值夹到边界，而不是回退默认值
  assert.equal(sanitizeConfig({ maxToolRounds: 0 }).maxToolRounds, minToolRounds);
  assert.equal(sanitizeConfig({ maxToolRounds: 99_999 }).maxToolRounds, maxToolRounds);
  assert.equal(maxToolRounds, 1024);
  // 合法值原样保留（含四舍五入）
  assert.equal(sanitizeConfig({ maxToolRounds: 300 }).maxToolRounds, 300);
  assert.equal(sanitizeConfig({ maxToolRounds: 12.6 }).maxToolRounds, 13);
  // 非数值回退默认值
  const badInput = { maxToolRounds: 'many' } as unknown as Partial<AppConfig>;
  assert.equal(sanitizeConfig(badInput).maxToolRounds, defaultConfig.maxToolRounds);
});

test('resolveCloseBehavior 决策矩阵：win32 按配置', () => {
  assert.equal(resolveCloseBehavior('ask', 'win32'), 'ask');
  assert.equal(resolveCloseBehavior('minimize', 'win32'), 'minimize');
  assert.equal(resolveCloseBehavior('exit', 'win32'), 'exit');
});

test('resolveCloseBehavior 决策矩阵：非 win32 走平台默认', () => {
  assert.equal(resolveCloseBehavior('ask', 'darwin'), 'native');
  assert.equal(resolveCloseBehavior('exit', 'linux'), 'native');
});
