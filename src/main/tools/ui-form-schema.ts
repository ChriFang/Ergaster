import { z } from 'zod';
import type { ToolSchemaShape } from '../../shared/tools';
import type { UiFormSpec } from '../../shared/ui-form';
import { MAX_UI_FORM_FIELDS, MAX_UI_FORM_OPTIONS, UI_FORM_VERSION } from '../../shared/ui-form';

/**
 * ui_form 工具的参数定义与校验（零 Electron 依赖，可直接单测）。
 *
 * 说明：strict 模式在 oneApi 兼容改写里会被整个剥掉（deepseek-client.toOneApiCompatibleTools），
 * 所以 JSON Schema 只是给模型的“形状提示”，真正的守卫是下面的 Zod validator。
 * 为兼容 strict：对象每个属性都进 required，可选项用可空类型（["string","null"]）表达。
 */
const FIELD_NAME_RE = /^[a-zA-Z0-9_]{1,32}$/;

export const uiFormParameters: ToolSchemaShape = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 60, description: '表单标题，简明说明要收集什么，不超过 60 字' },
    description: { type: ['string', 'null'], description: '可选的补充说明；无则填 null' },
    submitLabel: { type: ['string', 'null'], description: '可选的提交按钮文案；无则填 null（默认“提交”）' },
    fields: {
      type: 'array',
      description: `要收集的字段，1..${MAX_UI_FORM_FIELDS} 个`,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '结果键名，仅字母/数字/下划线，1..32 位' },
          label: { type: 'string', maxLength: 60, description: '字段标题（展示给用户），务必简短、不超过 60 字；较长的说明或举例放到表单 description 或该字段 placeholder，不要把 label 写成整句长问句' },
          type: { type: 'string', enum: ['text', 'select', 'radio'], description: 'text=输入框；select=下拉单选；radio=单选按钮' },
          required: { type: 'boolean', description: '是否必填' },
          placeholder: { type: ['string', 'null'], description: 'text 类占位提示；其余填 null' },
          options: { type: ['array', 'null'], items: { type: 'string' }, description: 'select/radio 的候选项；text 类填 null' },
          defaultValue: { type: ['string', 'null'], description: '默认值；无则填 null' },
        },
        required: ['name', 'label', 'type', 'required', 'placeholder', 'options', 'defaultValue'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'description', 'submitLabel', 'fields'],
  additionalProperties: false,
};

const uiFormFieldSchema = z
  .object({
    name: z.string().regex(FIELD_NAME_RE, 'name 只能包含字母/数字/下划线且不超过 32 位'),
    label: z.string().trim().min(1, 'label 不能为空').max(60, 'label 不超过 60 字'),
    type: z.enum(['text', 'select', 'radio']),
    required: z.boolean(),
    placeholder: z.string().nullish(),
    options: z.array(z.string().trim().min(1)).nullish(),
    defaultValue: z.string().nullish(),
  })
  .superRefine((field, ctx) => {
    if (field.type !== 'select' && field.type !== 'radio') {
      return;
    }
    const options = field.options ?? [];
    if (options.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `字段 ${field.name}：${field.type} 必须提供 options` });
    }
    if (options.length > MAX_UI_FORM_OPTIONS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `字段 ${field.name}：options 不超过 ${MAX_UI_FORM_OPTIONS} 个` });
    }
  });

export const uiFormArgsSchema = z
  .object({
    title: z.string().trim().min(1, 'title 不能为空').max(60, 'title 不超过 60 字'),
    description: z.string().nullish(),
    submitLabel: z.string().nullish(),
    fields: z
      .array(uiFormFieldSchema)
      .min(1, '至少需要 1 个字段')
      .max(MAX_UI_FORM_FIELDS, `字段不超过 ${MAX_UI_FORM_FIELDS} 个`),
  })
  .superRefine((form, ctx) => {
    const seen = new Set<string>();
    for (const field of form.fields) {
      if (seen.has(field.name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `字段名重复：${field.name}` });
      }
      seen.add(field.name);
    }
  });

export type UiFormArgs = z.infer<typeof uiFormArgsSchema>;

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 把校验通过的参数归一化成 renderer 可直接消费的 spec；widgetId 由主进程注入。 */
export function buildUiFormSpec(args: UiFormArgs, widgetId: string): UiFormSpec {
  return {
    version: UI_FORM_VERSION,
    widgetId,
    title: args.title.trim(),
    description: cleanText(args.description),
    submitLabel: cleanText(args.submitLabel),
    fields: args.fields.map((field) => {
      const isChoice = field.type === 'select' || field.type === 'radio';
      return {
        name: field.name,
        label: field.label.trim(),
        type: field.type,
        required: field.required,
        placeholder: field.type === 'text' ? cleanText(field.placeholder) : null,
        options: isChoice ? (field.options ?? []).map((option) => option.trim()).filter(Boolean) : null,
        defaultValue: cleanText(field.defaultValue),
      };
    }),
  };
}
