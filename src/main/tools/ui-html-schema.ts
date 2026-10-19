import { z } from 'zod';
import type { ToolSchemaShape } from '../../shared/tools';
import type { UiHtmlSpec } from '../../shared/ui-form';
import { MAX_UI_HTML_BYTES, UI_HTML_VERSION } from '../../shared/ui-form';

/**
 * render_ui 工具的参数定义与校验（零 Electron 依赖，可直接单测）。
 * 只校验形状与体积；HTML 不做净化——安全边界是 renderer 侧的 sandbox iframe + CSP，
 * 见 renderer/lib/utils/ui-html-document。
 */
export const uiHtmlParameters: ToolSchemaShape = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '组件标题，简述这个交互界面是做什么的' },
    html: {
      type: 'string',
      description:
        '完整的 HTML 片段（可含 <style> 与 <script>）。运行在无同源、无网络的沙箱里；'
        + '收集到结果后调用 window.agentSubmit(data) 回传，不要用 fetch/XHR（会被 CSP 拦截）。',
    },
  },
  required: ['title', 'html'],
  additionalProperties: false,
};

const byteLength = (value: string) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(value).length : Buffer.byteLength(value, 'utf8'));

export const uiHtmlArgsSchema = z.object({
  title: z.string().trim().min(1, 'title 不能为空').max(60, 'title 不超过 60 字'),
  html: z
    .string()
    .min(1, 'html 不能为空')
    .refine((value) => byteLength(value) <= MAX_UI_HTML_BYTES, `html 体积不超过 ${Math.floor(MAX_UI_HTML_BYTES / 1024)}KB`),
});

export type UiHtmlArgs = z.infer<typeof uiHtmlArgsSchema>;

/** 把校验通过的参数归一化成 renderer 可消费的 spec；widgetId 由主进程注入。 */
export function buildUiHtmlSpec(args: UiHtmlArgs, widgetId: string): UiHtmlSpec {
  return {
    version: UI_HTML_VERSION,
    widgetId,
    title: args.title.trim(),
    html: args.html,
  };
}
