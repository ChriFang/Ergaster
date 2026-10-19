import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppConfig } from '../../shared/config';
import type { ToolDefinition } from '../../shared/tools';
import type { CapabilityModule } from './types';
import { collectAllTools, selectEnabledTools } from './capability-select';

function fakeTool(name: string): ToolDefinition<unknown> {
  return {
    name,
    description: '',
    risk: 'low',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    validator: { safeParse: () => ({ success: true, data: {} }) } as unknown as ToolDefinition<unknown>['validator'],
    source: { type: 'system' },
    execute: async () => ({ ok: true, content: '' }),
  };
}

function fakeModule(id: string, enabled: boolean, toolNames: string[]): CapabilityModule {
  return {
    id,
    isEnabled: () => enabled,
    getTools: () => toolNames.map(fakeTool),
  };
}

const dummyConfig = {} as AppConfig;

test('selectEnabledTools 只收集启用模块的工具', () => {
  const modules = [
    fakeModule('mail', true, ['email_a', 'email_b']),
    fakeModule('other', false, ['x_a']),
  ];

  const names = selectEnabledTools(modules, dummyConfig).map((tool) => tool.name);

  assert.deepEqual(names, ['email_a', 'email_b']);
});

test('selectEnabledTools 全部关闭时返回空', () => {
  const modules = [fakeModule('mail', false, ['email_a'])];
  assert.deepEqual(selectEnabledTools(modules, dummyConfig), []);
});

test('selectEnabledTools 跳过没有 getTools 的模块', () => {
  const modules: CapabilityModule[] = [{ id: 'noop', isEnabled: () => true }];
  assert.deepEqual(selectEnabledTools(modules, dummyConfig), []);
});

test('collectAllTools 忽略开关收集全部工具', () => {
  const modules = [
    fakeModule('mail', false, ['email_a']),
    fakeModule('other', true, ['x_a', 'x_b']),
  ];

  const names = collectAllTools(modules).map((tool) => tool.name);

  assert.deepEqual(names, ['email_a', 'x_a', 'x_b']);
});


