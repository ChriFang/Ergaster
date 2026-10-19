import type { UiFormSpec } from '../../../shared/ui-form';

export type UiFormValues = Record<string, string>;

/** 校验必填项，返回缺失的字段 name 列表（空数组表示通过）。 */
export function findMissingRequiredFields(spec: UiFormSpec, values: UiFormValues): string[] {
  return spec.fields
    .filter((field) => field.required && (values[field.name] ?? '').trim().length === 0)
    .map((field) => field.name);
}

/** 把字段值按 spec 归一化（补齐缺失键、trim），供摘要与 JSON 复用。 */
function normalizeValues(spec: UiFormSpec, values: UiFormValues): UiFormValues {
  const normalized: UiFormValues = {};
  for (const field of spec.fields) {
    normalized[field.name] = (values[field.name] ?? '').trim();
  }
  return normalized;
}

/** 提交结果的显示摘要：进入会话气泡与落盘的那份用户消息。 */
export function buildUiSubmitSummary(spec: UiFormSpec, values: UiFormValues): string {
  const normalized = normalizeValues(spec, values);
  const parts = spec.fields.map((field) => `${field.label}=${normalized[field.name] || '(空)'}`);
  return `已提交表单「${spec.title}」：${parts.join('、')}`;
}

/** 发给模型的那份：摘要 + 结构化 JSON（带 widgetId 供模型对账本轮是哪张表单）。 */
export function buildUiSubmitPromptForModel(spec: UiFormSpec, values: UiFormValues): string {
  return [
    buildUiSubmitSummary(spec, values),
    '',
    `【表单提交结果 widgetId=${spec.widgetId}】`,
    JSON.stringify(normalizeValues(spec, values)),
  ].join('\n');
}
