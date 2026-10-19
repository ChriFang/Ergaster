import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolResult } from '../../shared/tools';
import { defaultToolTimeoutMs } from '../../shared/tools';
import type { UiWidgetPayload } from '../../shared/ui-form';
import { buildUiFormSpec, uiFormArgsSchema, uiFormParameters, type UiFormArgs } from './ui-form-schema';

const UI_FORM_DESCRIPTION = [
  '向用户展示一个表单来收集参数或让用户在选项中作答。用户填写并提交后，提交内容会作为新的一条用户消息发回给你。',
  '适用：需要收集 2 个以上参数；参数有明确可选值（如选环境、分支、日期范围）；需要用户在有限选项中做决策；出选择题、做问卷等需要用户在选项里选择作答的场景。',
  '不适用：只缺一个开放性问题（直接用文字问更快）；用户已把参数说全；只是展示信息（该用 Markdown 表格）。',
  '字段 label 要简短（不超过 60 字），不要写成整句长问句；较长的说明、举例或背景放到表单 description 或字段 placeholder 里。',
  '一次最多 10 个字段；调用后只需极简收尾，不要用文字把表单里的问题或选项再复述一遍。',
].join('\n');

/**
 * ui_form：在会话区渲染一个受控表单收集参数。
 * 展示型工具（presentational）——只渲染 UI、无副作用，故跳过确认弹窗。
 * widgetId 由主进程生成，提交时由 renderer 回传对账，模型不参与生成。
 */
export const uiFormTool: ToolDefinition<unknown> = {
  name: 'ui_form',
  description: UI_FORM_DESCRIPTION,
  risk: 'low',
  strict: true,
  presentational: true,
  parameters: uiFormParameters,
  validator: uiFormArgsSchema,
  timeoutMs: defaultToolTimeoutMs,
  source: { type: 'system' },
  execute: async (args, context): Promise<ToolResult> => {
    const spec = buildUiFormSpec(args as UiFormArgs, `ui-${randomUUID()}`);
    const payload: UiWidgetPayload = { kind: 'form', widgetId: spec.widgetId, spec };
    context.emitUiWidget?.(payload);

    return {
      ok: true,
      content: [
        `表单「${spec.title}」已渲染在会话区，正在等待用户填写并提交；提交结果会作为新的一条用户消息发给你。`,
        '现在只回一句极简收尾（不超过 20 字，例如告知表单已就绪），不要复述表单里的问题或选项，也不要假设用户已填。若之后还需要用户作答，必须再次调用 ui_form 生成新表单。',
      ].join('\n'),
    };
  },
};
