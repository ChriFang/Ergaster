import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolResult } from '../../shared/tools';
import { defaultToolTimeoutMs } from '../../shared/tools';
import type { UiWidgetPayload } from '../../shared/ui-form';
import { buildUiHtmlSpec, uiHtmlArgsSchema, uiHtmlParameters, type UiHtmlArgs } from './ui-html-schema';

const RENDER_UI_DESCRIPTION = [
  '在会话区渲染一个交互式 HTML 界面（图表、canvas、拖拽、自定义控件等）。用户操作完成后其提交的数据会作为新的一条用户消息发回给你。',
  '适用：需要图形化或自由布局的交互；不适用：只是收集几个有界参数（那用 ui_form 更省事更安全）。',
  'HTML 运行在无同源、无网络的沙箱里：可以内联 <style>/<script>，但不能用 fetch/XHR（会被 CSP 拦截）。收集到结果后调用 window.agentSubmit(data) 回传；<form> 提交会被自动捕获。',
  '调用后不要再用文字复述界面内容。',
].join('\n');

/**
 * render_ui：在会话区用 sandbox iframe 承载模型产出的任意 HTML。
 * 展示型工具（presentational）——只渲染 UI、无副作用，跳过确认弹窗。
 * 安全边界在 renderer（sandbox + CSP + postMessage 校验），主进程只校形状与体积。
 */
export const renderUiTool: ToolDefinition<unknown> = {
  name: 'render_ui',
  description: RENDER_UI_DESCRIPTION,
  risk: 'low',
  strict: true,
  presentational: true,
  parameters: uiHtmlParameters,
  validator: uiHtmlArgsSchema,
  timeoutMs: defaultToolTimeoutMs,
  source: { type: 'system' },
  execute: async (args, context): Promise<ToolResult> => {
    const spec = buildUiHtmlSpec(args as UiHtmlArgs, `ui-${randomUUID()}`);
    const payload: UiWidgetPayload = { kind: 'html', widgetId: spec.widgetId, spec };
    context.emitUiWidget?.(payload);

    return {
      ok: true,
      content: [
        `交互界面「${spec.title}」已展示在会话区，正在等待用户操作。用户提交后会以新的一条用户消息把结果发给你。`,
        '现在只回一句不超过 20 字的说明（如“请在上方界面中操作”），不要假设用户提交了什么。',
      ].join('\n'),
    };
  },
};
