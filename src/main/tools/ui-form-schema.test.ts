import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUiFormSpec, uiFormArgsSchema } from './ui-form-schema';

type FieldOverrides = Record<string, unknown>;

function baseField(overrides: FieldOverrides = {}) {
  return {
    name: 'env',
    label: '环境',
    type: 'text',
    required: true,
    placeholder: null,
    options: null,
    defaultValue: null,
    ...overrides,
  };
}

function baseForm(fields: unknown[]) {
  return { title: '部署参数', description: null, submitLabel: null, fields };
}

test('合法表单通过校验并生成 spec', () => {
  const parsed = uiFormArgsSchema.parse(
    baseForm([
      baseField({ name: 'env', label: '环境', type: 'select', options: ['prod', 'staging'] }),
      baseField({ name: 'branch', label: '分支', type: 'text', placeholder: 'master' }),
    ]),
  );
  const spec = buildUiFormSpec(parsed, 'ui-test-1');

  assert.equal(spec.widgetId, 'ui-test-1');
  assert.equal(spec.version, 1);
  assert.equal(spec.fields.length, 2);
  assert.deepEqual(spec.fields[0].options, ['prod', 'staging']);
  // text 字段的 options 归一化为 null
  assert.equal(spec.fields[1].options, null);
  assert.equal(spec.fields[1].placeholder, 'master');
});

test('字段超过上限被拒', () => {
  const fields = Array.from({ length: 9 }, (_, index) => baseField({ name: `f${index}`, label: `字段${index}` }));
  assert.equal(uiFormArgsSchema.safeParse(baseForm(fields)).success, false);
});

test('select 缺少 options 被拒', () => {
  assert.equal(uiFormArgsSchema.safeParse(baseForm([baseField({ type: 'select', options: [] })])).success, false);
});

test('options 超过上限被拒', () => {
  const options = Array.from({ length: 13 }, (_, index) => `opt-${index}`);
  assert.equal(uiFormArgsSchema.safeParse(baseForm([baseField({ type: 'radio', options })])).success, false);
});

test('name 含非法字符被拒', () => {
  assert.equal(uiFormArgsSchema.safeParse(baseForm([baseField({ name: 'bad name' })])).success, false);
});

test('字段名重复被拒', () => {
  assert.equal(
    uiFormArgsSchema.safeParse(baseForm([baseField({ name: 'dup' }), baseField({ name: 'dup', label: '第二个' })])).success,
    false,
  );
});

test('空字段列表被拒', () => {
  assert.equal(uiFormArgsSchema.safeParse(baseForm([])).success, false);
});

test('label 恰好 60 字通过', () => {
  const label60 = '标'.repeat(60);
  assert.equal(uiFormArgsSchema.safeParse(baseForm([baseField({ label: label60 })])).success, true);
});

test('label 超过 60 字被拒', () => {
  const label61 = '标'.repeat(61);
  assert.equal(uiFormArgsSchema.safeParse(baseForm([baseField({ label: label61 })])).success, false);
});
