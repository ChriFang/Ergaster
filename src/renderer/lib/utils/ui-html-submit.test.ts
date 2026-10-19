import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UiHtmlSpec } from '../../../shared/ui-form';
import { buildUiHtmlSubmitPromptForModel, buildUiHtmlSubmitSummary } from './ui-html-submit';

const SPEC: UiHtmlSpec = { version: 1, widgetId: 'ui-html-1', title: '配色', html: '<div></div>' };

test('摘要含标题与数据预览', () => {
  const summary = buildUiHtmlSubmitSummary(SPEC.title, { color: '#fff', size: 3 });
  assert.ok(summary.includes('配色'));
  assert.ok(summary.includes('color'));
});

test('超长数据预览被截断', () => {
  const big = { note: 'x'.repeat(300) };
  assert.ok(buildUiHtmlSubmitSummary('t', big).endsWith('…'));
});

test('发给模型的内容含 widgetId 与完整 JSON', () => {
  const text = buildUiHtmlSubmitPromptForModel(SPEC, { color: '#fff' });
  assert.ok(text.includes('widgetId=ui-html-1'));
  assert.ok(text.includes('"color":"#fff"'));
});
