import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UiFormSpec } from '../../../shared/ui-form';
import { buildUiSubmitPromptForModel, buildUiSubmitSummary, findMissingRequiredFields } from './ui-form-submit';

function makeSpec(): UiFormSpec {
  return {
    version: 1,
    widgetId: 'ui-abc',
    title: '部署参数',
    description: null,
    submitLabel: null,
    fields: [
      { name: 'env', label: '环境', type: 'select', required: true, placeholder: null, options: ['prod', 'staging'], defaultValue: null },
      { name: 'note', label: '备注', type: 'text', required: false, placeholder: null, options: null, defaultValue: null },
    ],
  };
}

test('必填项缺失被标记', () => {
  assert.deepEqual(findMissingRequiredFields(makeSpec(), { note: 'x' }), ['env']);
});

test('必填项满足时通过', () => {
  assert.deepEqual(findMissingRequiredFields(makeSpec(), { env: 'prod' }), []);
});

test('空白字符串不算已填', () => {
  assert.deepEqual(findMissingRequiredFields(makeSpec(), { env: '   ' }), ['env']);
});

test('摘要按字段标签拼接', () => {
  assert.equal(buildUiSubmitSummary(makeSpec(), { env: 'prod', note: '' }), '已提交表单「部署参数」：环境=prod、备注=(空)');
});

test('发给模型的内容含 widgetId 与归一化 JSON', () => {
  const text = buildUiSubmitPromptForModel(makeSpec(), { env: 'prod', note: '  hi  ' });
  assert.ok(text.includes('widgetId=ui-abc'));
  assert.ok(text.includes('"env":"prod"'));
  // 值被 trim
  assert.ok(text.includes('"note":"hi"'));
});
