import type { UiHtmlSpec } from '../../../shared/ui-form';

/** 交互式 HTML widget 回传的数据（结构由模型自定义）。 */
export type UiHtmlSubmitData = Record<string, unknown>;

function safeJson(data: UiHtmlSubmitData): string {
  try {
    return JSON.stringify(data);
  } catch {
    return '{}';
  }
}

/** 提交结果的显示摘要：进入会话气泡与落盘的那份用户消息（数据可能任意，预览截断）。 */
export function buildUiHtmlSubmitSummary(title: string, data: UiHtmlSubmitData): string {
  const json = safeJson(data);
  const preview = json.length > 120 ? `${json.slice(0, 120)}…` : json;
  return `已提交交互组件「${title}」：${preview}`;
}

/** 发给模型的那份：说明 + widgetId + 完整 JSON。 */
export function buildUiHtmlSubmitPromptForModel(spec: UiHtmlSpec, data: UiHtmlSubmitData): string {
  return [
    `已提交交互组件「${spec.title}」。`,
    '',
    `【交互结果 widgetId=${spec.widgetId}】`,
    safeJson(data),
  ].join('\n');
}
