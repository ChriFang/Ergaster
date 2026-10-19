import assert from 'node:assert/strict';
import test from 'node:test';
import type { MailAccountConfig } from '../../shared/mail';
import {
  applyDefaultFlag,
  normalizeAccount,
  pickDefaultAccount,
  toMaskedAccount,
  validateAccountInput,
} from './mail-account-utils';

function makeAccount(overrides: Partial<MailAccountConfig> = {}): MailAccountConfig {
  return {
    id: 'a1',
    label: 'Work',
    host: 'imap.example.com',
    port: 993,
    security: 'tls',
    user: 'me@example.com',
    encryptedPassword: 'ENC',
    isDefault: false,
    ...overrides,
  };
}

test('validateAccountInput 规范化端口与安全类型，保留 id 与密码', () => {
  const result = validateAccountInput({
    id: '  a1 ',
    label: '  Work ',
    host: ' imap.example.com ',
    port: 0,
    security: 'weird' as never,
    user: ' me@example.com ',
    password: 'secret',
    isDefault: true,
  });

  assert.equal(result.id, 'a1');
  assert.equal(result.label, 'Work');
  assert.equal(result.host, 'imap.example.com');
  assert.equal(result.security, 'tls');
  assert.equal(result.port, 993); // 非法端口回退到 tls 默认 993
  assert.equal(result.user, 'me@example.com');
  assert.equal(result.password, 'secret');
  assert.equal(result.isDefault, true);
});

test('validateAccountInput 对 starttls 回退到 143，且空密码视为未设置', () => {
  const result = validateAccountInput({
    label: 'X',
    host: 'h',
    port: undefined as never,
    security: 'starttls',
    user: 'u',
    password: '',
  });
  assert.equal(result.port, 143);
  assert.equal(result.password, undefined);
  assert.equal(result.id, undefined);
});

test('validateAccountInput 缺字段抛出可读错误', () => {
  assert.throws(() => validateAccountInput({ label: '', host: 'h', port: 993, security: 'tls', user: 'u' }), /账户名称不能为空/);
  assert.throws(() => validateAccountInput({ label: 'x', host: '', port: 993, security: 'tls', user: 'u' }), /服务器地址不能为空/);
  assert.throws(() => validateAccountInput({ label: 'x', host: 'h', port: 993, security: 'tls', user: '' }), /用户名不能为空/);
});

test('normalizeAccount 组装落盘配置', () => {
  const config = normalizeAccount({
    id: 'a9',
    input: validateAccountInput({ label: 'X', host: 'h', port: 993, security: 'tls', user: 'u', password: 'p' }),
    encryptedPassword: 'ENC',
    isDefault: true,
  });
  assert.equal(config.id, 'a9');
  assert.equal(config.encryptedPassword, 'ENC');
  assert.equal(config.isDefault, true);
});

test('toMaskedAccount 不含加密密码，且标注 hasPassword', () => {
  const masked = toMaskedAccount(makeAccount({ encryptedPassword: 'ENC' }));
  assert.equal(JSON.stringify(masked).includes('ENC'), false);
  assert.equal(masked.hasPassword, true);
  assert.equal(toMaskedAccount(makeAccount({ encryptedPassword: '' })).hasPassword, false);
});

test('pickDefaultAccount 按 id / label / 默认 / 首个 解析', () => {
  const accounts = [makeAccount({ id: 'a1', label: 'Work' }), makeAccount({ id: 'a2', label: 'Home', isDefault: true })];
  assert.equal(pickDefaultAccount(accounts, 'a1')?.id, 'a1');
  assert.equal(pickDefaultAccount(accounts, 'Home')?.id, 'a2');
  assert.equal(pickDefaultAccount(accounts)?.id, 'a2'); // 默认账户
  assert.equal(pickDefaultAccount([makeAccount({ id: 'only' })])?.id, 'only'); // 无默认则首个
  assert.equal(pickDefaultAccount(accounts, 'missing'), null);
  assert.equal(pickDefaultAccount([]), null);
});

test('applyDefaultFlag 保证至多一个默认', () => {
  const accounts = [makeAccount({ id: 'a1', isDefault: true }), makeAccount({ id: 'a2', isDefault: true })];
  const applied = applyDefaultFlag(accounts, 'a2');
  assert.deepEqual(applied.map((a) => a.isDefault), [false, true]);

  const fallback = applyDefaultFlag([makeAccount({ id: 'a1' }), makeAccount({ id: 'a2' })], 'missing');
  assert.deepEqual(fallback.map((a) => a.isDefault), [true, false]); // 默认落到首个
  assert.deepEqual(applyDefaultFlag([], null), []);
});
