/**
 * 会话区交互式表单（UI DSL v1）。
 *
 * 模型通过 ui_form 工具产出「字段定义」，renderer 渲染成受控表单；
 * 用户填写并提交后，内容作为新的一条用户消息发回模型，形成交互闭环。
 * 只承载有界字段（文本 / 下拉单选 / 单选按钮），不承载任意 HTML 或脚本。
 */

/** 单次表单允许的最大字段数。超过说明任务该拆，而不是堆成一个巨型表单。 */
export const MAX_UI_FORM_FIELDS = 8;
/** select / radio 单个字段允许的最大选项数。 */
export const MAX_UI_FORM_OPTIONS = 12;
/** DSL 版本号。renderer 遇到不认识的版本时降级为只读展示，避免老会话重载白屏。 */
export const UI_FORM_VERSION = 1;

export type UiFormFieldType = 'text' | 'select' | 'radio';

export type UiFormField = {
  /** 提交结果里的键名，须匹配 [a-zA-Z0-9_]{1,32}。 */
  name: string;
  /** 展示给用户的字段标题。 */
  label: string;
  type: UiFormFieldType;
  required: boolean;
  /** 占位提示，仅 text 类有意义；其余为 null。 */
  placeholder: string | null;
  /** select / radio 的候选项；text 类为 null。 */
  options: string[] | null;
  /** 预填默认值；无默认时为 null。 */
  defaultValue: string | null;
};

export type UiFormSpec = {
  version: typeof UI_FORM_VERSION;
  /** 由主进程生成、提交时回传以对账；模型不参与生成。 */
  widgetId: string;
  title: string;
  description: string | null;
  submitLabel: string | null;
  fields: UiFormField[];
};

/** 交互式 HTML widget 版本号；同样用于 renderer 降级判断。 */
export const UI_HTML_VERSION = 1;
/** 单个 HTML widget 的体积上限（字节）。防止模型产出超大 HTML 拖垮渲染/网关。 */
export const MAX_UI_HTML_BYTES = 64 * 1024;

/**
 * 交互式 HTML widget：模型产出任意 HTML/JS 片段,renderer 用带 CSP 的 sandbox iframe 承载。
 * 只承载片段本身,外层文档、CSP、桥接脚本由 renderer 包装(见 ui-html-document)。
 */
export type UiHtmlSpec = {
  version: typeof UI_HTML_VERSION;
  widgetId: string;
  title: string;
  html: string;
};

/**
 * 推送到会话区的交互组件载荷。走流事件的瞬时通道（第一版不持久化），
 * 与 filePreview 同构：由主进程注入 turnUserId，renderer 据此挂到产生它的那一轮。
 * 判别字段 kind：'form' 为受控表单，'html' 为 sandbox iframe 承载的任意 HTML。
 */
export type UiWidgetPayload =
  | { kind: 'form'; widgetId: string; turnUserId?: string; spec: UiFormSpec }
  | { kind: 'html'; widgetId: string; turnUserId?: string; spec: UiHtmlSpec };

/**
 * 交互式 HTML widget「弹出独立窗口」相关载荷。
 *
 * 用户点内联卡片的「弹出窗口」后，主进程新开一个复用同款硬化 webPreferences 的 BrowserWindow，
 * 承载与内联同构的 sandbox iframe；提交/关闭经主进程回传主窗口，走与内联提交同一条 runAgent 链路。
 * 弹出期间内联卡片降级为占位（唯一交互实例在独立窗口），关闭后自动恢复。
 */
export type UiWindowOpenInput = {
  conversationId: string;
  widgetId: string;
  title: string;
  html: string;
};

/** 弹出窗口 renderer 启动后凭 token 认领的载荷（即 open 时存入主进程的那份）。 */
export type UiWindowPayload = UiWindowOpenInput;

/** 弹出窗口提交回传：token 定位是哪个弹窗，data 为 HTML 内自定义的提交数据。 */
export type UiWindowSubmitInput = {
  token: string;
  data: Record<string, unknown>;
};

/** 主进程 → 主窗口的弹出窗口事件：submit 触发回流，closed 让内联卡片恢复。 */
export type UiWindowEvent =
  | { type: 'submit'; conversationId: string; widgetId: string; title: string; data: Record<string, unknown> }
  | { type: 'closed'; conversationId: string; widgetId: string };
