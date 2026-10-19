import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_UI_HTML_BYTES } from '../../shared/ui-form';
import { buildUiHtmlSpec, uiHtmlArgsSchema } from './ui-html-schema';

test('合法参数通过校验并生成 spec', () => {
  const parsed = uiHtmlArgsSchema.parse({ title: '  投票  ', html: '<button onclick="agentSubmit({v:1})">投</button>' });
  const spec = buildUiHtmlSpec(parsed, 'ui-html-1');
  assert.equal(spec.widgetId, 'ui-html-1');
  assert.equal(spec.version, 1);
  assert.equal(spec.title, '投票');
  assert.ok(spec.html.includes('agentSubmit'));
});

test('空 html 被拒', () => {
  assert.equal(uiHtmlArgsSchema.safeParse({ title: 't', html: '' }).success, false);
});

test('空 title 被拒', () => {
  assert.equal(uiHtmlArgsSchema.safeParse({ title: '   ', html: '<div>x</div>' }).success, false);
});

test('超体积 html 被拒', () => {
  const huge = 'x'.repeat(MAX_UI_HTML_BYTES + 1);
  assert.equal(uiHtmlArgsSchema.safeParse({ title: 't', html: huge }).success, false);
});
