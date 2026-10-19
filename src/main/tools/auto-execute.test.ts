import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveUnattendedApproval, shouldAutoExecute } from './auto-execute';

const mediumTool = { name: 'create_text_draft', risk: 'medium' as const };
const highTool = { name: 'run_command', risk: 'high' as const };
const allowlist = ['create_text_draft'];

test('shouldAutoExecute 名单命中且非 high 时放行', () => {
  assert.equal(shouldAutoExecute(mediumTool, allowlist, false), true);
});

test('shouldAutoExecute workflow/子智能体链路一律不自动执行', () => {
  assert.equal(shouldAutoExecute(mediumTool, allowlist, true), false);
});

test('shouldAutoExecute high 工具即使误配清单也强制弹窗', () => {
  assert.equal(shouldAutoExecute(highTool, ['run_command'], false), false);
});

test('shouldAutoExecute 无全局清单或未命中名单时不放行', () => {
  assert.equal(shouldAutoExecute(mediumTool, undefined, false), false);
  assert.equal(shouldAutoExecute(mediumTool, [], false), false);
  assert.equal(shouldAutoExecute({ name: 'http_request', risk: 'medium' as const }, allowlist, false), false);
});

test('resolveUnattendedApproval 放行 low/medium，拒绝 high 并给出原因', () => {
  assert.equal(resolveUnattendedApproval({ name: 'read_file', risk: 'low' as const }).approved, true);
  assert.equal(resolveUnattendedApproval(mediumTool).approved, true);

  const highDecision = resolveUnattendedApproval(highTool);
  assert.equal(highDecision.approved, false);
  assert.match(highDecision.reason ?? '', /run_command/);
});
