import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultConfig, getModelEffortOptions, type AppConfig } from '../../shared/config';
import { buildReasoningParams, isDeepSeekEndpoint, resolveModelEffort } from './reasoning-params';

function makeConfig(overrides: Partial<AppConfig>): AppConfig {
  return { ...defaultConfig, ...overrides };
}

test('isDeepSeekEndpoint 识别 deepseek.com 及其子域，其它域名与非法值返回 false', () => {
  assert.equal(isDeepSeekEndpoint('https://api.deepseek.com'), true);
  assert.equal(isDeepSeekEndpoint('https://api.deepseek.com/v1'), true);
  assert.equal(isDeepSeekEndpoint('https://deepseek.com'), true);
  assert.equal(isDeepSeekEndpoint('https://api.openai.com'), false);
  assert.equal(isDeepSeekEndpoint('not-a-url'), false);
});

test('resolveModelEffort 查不到该模型时回落最低档 low', () => {
  const config = makeConfig({ reasoningEffortByModel: { 'deepseek-v4-pro': 'max' } });
  assert.equal(resolveModelEffort(config, 'deepseek-v4-pro'), 'max');
  assert.equal(resolveModelEffort(config, 'deepseek-v4-flash'), 'low');
});

test('buildReasoningParams 思考开启时顶层下发 thinking.enabled 与所选模型档位', () => {
  const config = makeConfig({
    thinkingModeEnabled: true,
    model: 'deepseek-v4-pro',
    reasoningEffortByModel: { 'deepseek-v4-pro': 'high' },
  });
  assert.deepEqual(buildReasoningParams(config), {
    thinking: { type: 'enabled' },
    reasoning_effort: 'high',
  });
});

test('buildReasoningParams 未配置的模型默认使用 low', () => {
  const config = makeConfig({ thinkingModeEnabled: true, model: 'deepseek-v4-flash' });
  assert.deepEqual(buildReasoningParams(config), {
    thinking: { type: 'enabled' },
    reasoning_effort: 'low',
  });
});

test('buildReasoningParams 思考关闭时显式下发 disabled 且不带 effort', () => {
  const config = makeConfig({ thinkingModeEnabled: false, model: 'deepseek-v4-pro' });
  assert.deepEqual(buildReasoningParams(config), { thinking: { type: 'disabled' }, reasoning_effort: 'low' });
});

test('buildReasoningParams 非 DeepSeek 且开启 OneAPI 兼容时仅下发 effort、不下发 thinking', () => {
  const config = makeConfig({
    thinkingModeEnabled: true,
    oneApiCompatibilityEnabled: true,
    apiBaseUrl: 'https://oneapi.example.com',
    model: 'deepseek-v4-pro',
    reasoningEffortByModel: { 'deepseek-v4-pro': 'high' },
  });
  assert.deepEqual(buildReasoningParams(config), { reasoning_effort: 'high' });
});

test('buildReasoningParams 思考关闭且开启 OneAPI 兼容时仍仅下发 effort', () => {
  const config = makeConfig({
    thinkingModeEnabled: false,
    oneApiCompatibilityEnabled: true,
    apiBaseUrl: 'https://oneapi.example.com',
  });
  assert.deepEqual(buildReasoningParams(config), { reasoning_effort: 'low' });
});

test('buildReasoningParams OneAPI 兼容但指向 DeepSeek 仍下发', () => {
  const config = makeConfig({
    thinkingModeEnabled: true,
    oneApiCompatibilityEnabled: true,
    apiBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    reasoningEffortByModel: { 'deepseek-v4-pro': 'max' },
  });
  assert.deepEqual(buildReasoningParams(config), {
    thinking: { type: 'enabled' },
    reasoning_effort: 'max',
  });
});

test('getModelEffortOptions opus 系五档，gpt 系四档，其余默认三档', () => {
  assert.deepEqual(getModelEffortOptions('claude-opus-4.8'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(getModelEffortOptions('Opus-4.8'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(getModelEffortOptions('gpt-5.4'), ['low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(getModelEffortOptions('openai/gpt-5.4-mini'), ['low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(getModelEffortOptions('deepseek-v4-pro'), ['low', 'high', 'max']);
  assert.deepEqual(getModelEffortOptions('grok-4.7'), ['low', 'high', 'max']);
});

test('resolveModelEffort 档位不在该模型集合内时回落 low', () => {
  const config = makeConfig({
    model: 'deepseek-v4-pro',
    reasoningEffortByModel: { 'deepseek-v4-pro': 'xhigh' },
  });
  assert.equal(resolveModelEffort(config, 'deepseek-v4-pro'), 'low');
});

test('buildReasoningParams opus 模型可下发 xhigh 档位', () => {
  const config = makeConfig({
    thinkingModeEnabled: true,
    model: 'claude-opus-4.8',
    reasoningEffortByModel: { 'claude-opus-4.8': 'xhigh' },
  });
  assert.deepEqual(buildReasoningParams(config), {
    thinking: { type: 'enabled' },
    reasoning_effort: 'xhigh',
  });
});
