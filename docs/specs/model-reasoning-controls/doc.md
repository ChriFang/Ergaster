# 思考模式开关修复 + 思考强度（Reasoning Effort）设置

## 一、需求背景与场景

本次拆分为两个强相关的子需求，均围绕"模型推理控制"，共用同一条请求构建与配置持久化链路。

### 子需求 A：修复"思考模式"开关（当前不可用）

- 现象：会话输入框 Composer 工具栏有「思考模式」脑图标按钮（`Composer.tsx:872`），点击可切换并即时持久化到全局配置，但对模型行为无任何影响。
- 根因（`deepseek-client.ts:153-159`）：请求体把 `thinking` 包在 `extra_body` 里——
  ```ts
  body.extra_body = { thinking: { type: 'enabled' } };
  ```
  `extra_body` 是 **OpenAI SDK 的客户端约定**：SDK 会在发送前把 `extra_body` 的内容展开合并到请求体顶层。本项目并不用 SDK，而是手拼 JSON 后用 `fetch` 直发（`deepseek-client.ts:286-294`），因此真正发出的报文里出现了一个顶层 `"extra_body"` 字段，DeepSeek 网关不识别、静默丢弃，`thinking` 从未下发。
- 叠加事实：DeepSeek V4-Pro/Flash 思考模式**默认开启**。于是开关 ON（坏参数被忽略→仍按默认思考）与 OFF（不发参数→仍按默认思考）在两个方向上都是空操作。
- 官方线上正确形态（顶层）：`{"thinking": {"type": "enabled" | "disabled"}}`。

### 子需求 B：新增"思考强度（Reasoning Effort）"设置（按模型独立配置）

- DeepSeek V4-Pro/V4-Flash（应用默认模型 `deepseek-v4-pro`）思考模式支持 **low / high / max** 三档强度，经 OpenAI 兼容的顶层 `reasoning_effort` 参数设置；官方映射：minimal/low→low、medium/high/xhigh→high、max/ultra→max。该参数是业界通用约定（OpenAI GPT-5/o3、Gemini 3 OpenAI 兼容层等均为 `reasoning_effort`）。
- 现状：应用完全不下发 `reasoning_effort`，用户无法控制思考深度与成本。
- 目标交互（按用户确认）：
  - **按模型独立配置**：每个模型各自保存一份 Effort 档位，互不影响；**默认使用最低档 `low`**。
  - **落盘持久化**：以「模型 → 档位」映射存入全局 `config.json`，重启后保留。
  - **展示**：模型下拉列表中，每个模型项名称后面直接显示其当前 Effort 档位。
  - **编辑入口**：hover 到某个模型项时其右侧出现编辑图标；点击后弹出 Effort 档位选择列表（低 / 高 / 最大），选择即保存。

## 二、技术方案与架构

严格遵循现有 `renderer -> preload -> main -> shared` 分层与全局 `AppConfig` 持久化边界，不新增独立字段族、不绕过既有 `config:save` 通道：

1. **参数修正（A）**：`buildRequestBody` 把 `thinking` 提到请求体顶层，并按开关**显式**下发 `enabled`/`disabled`——因模型默认开启，只有显式 `disabled` 才能真正关闭思考。
2. **新增按模型强度映射（B）**：`shared/config.ts` 的 `AppConfig` 增加 `reasoningEffortByModel: Record<string, ReasoningEffort>`（档位 `'low' | 'high' | 'max'`，默认空对象、查不到时回落最低档 `low`），复用 `config:save` 持久化；`buildRequestBody` 在思考开启时按当前 `config.model` 查表追加顶层 `reasoning_effort`。
3. **可测试性**：把纯参数拼装逻辑抽到零依赖模块 `agent/reasoning-params.ts`（不 import audit-log，规避测试环境无 Electron 的约束，先例 `agent/title-text-utils.ts`），由 `buildRequestBody` 调用并补单测（覆盖查表默认 low、显式档位、思考关闭三种情形）。
4. **UI**：改造 Composer 模型下拉列表——每个模型项显示当前档位徽标，hover 显示右侧编辑图标，点击弹出档位选择列表。复用 `handleThinkingModeChange` 同款"乐观更新 + 保存 + 失败回滚"新增 `handleModelReasoningEffortChange(model, effort)`。全局思考模式开关保持不变。
5. **网关门控**：沿用现有条件 `!oneApiCompatibilityEnabled || isDeepSeekEndpoint(apiBaseUrl)`，不向不支持该参数的第三方 OpenAI 兼容网关下发，避免报错。

## 三、影响文件

| 文件（绝对路径） | 修改类型 | 关键函数/位置 |
|---|---|---|
| `e:\my-project\desktop-tools\src\shared\config.ts` | 修改 | 新增 `ReasoningEffort` 类型；`AppConfig` 增 `reasoningEffortByModel` 映射；`defaultConfig` 置 `{}`；`sanitizeConfig` 逐项校验 |
| `e:\my-project\desktop-tools\src\main\agent\reasoning-params.ts` | 新增 | 纯函数 `buildReasoningParams` / `resolveModelEffort` + 迁入 `isDeepSeekEndpoint` |
| `e:\my-project\desktop-tools\src\main\agent\reasoning-params.test.ts` | 新增 | 覆盖查表默认 low / 显式档位 / 思考关闭 |
| `e:\my-project\desktop-tools\src\main\agent\deepseek-client.ts` | 修改 | `buildRequestBody`：调用 `buildReasoningParams`，顶层展开 thinking / reasoning_effort |
| `e:\my-project\desktop-tools\src\renderer\config-form.ts` | 修改 | `initialConfigForm` 增 `reasoningEffortByModel: {}` |
| `e:\my-project\desktop-tools\src\renderer\features\settings\settings-model.ts` | 修改 | `normalizeConfigForm` 透传 `reasoningEffortByModel` |
| `e:\my-project\desktop-tools\src\renderer\lib\hooks\use-settings-state.ts` | 修改 | `saveConfigWithValues` payload 加 `reasoningEffortByModel`；新增 `handleModelReasoningEffortChange` |
| `e:\my-project\desktop-tools\src\renderer\features\composer\Composer.tsx` | 修改 | 模型项档位徽标 + hover 编辑图标 + 档位选择弹层；新增相关 props |
| `e:\my-project\desktop-tools\src\renderer\features\layout\ConsolePanel.tsx` | 修改 | 透传 `reasoningEffortByModel`/`onModelReasoningEffortChange` |
| `e:\my-project\desktop-tools\src\renderer\features\layout\ChatConsoleView.tsx` | 修改 | 同上透传 |
| `e:\my-project\desktop-tools\src\renderer\features\workflows\WorkflowConsoleView.tsx` | 修改 | 同上透传 |
| `e:\my-project\desktop-tools\src\renderer\App.tsx` | 修改 | 从 `useSettingsState` 接线到 `ConsolePanel` |
| `e:\my-project\desktop-tools\package.json` | 修改 | 注册新测试（esbuild 打包列表 + node --test 运行列表两处） |

## 四、实现细节（关键片段）

### 1. shared/config.ts

```ts
export type ReasoningEffort = 'low' | 'high' | 'max';

export type AppConfig = {
  // ...
  thinkingModeEnabled: boolean;
  reasoningEffortByModel: Record<string, ReasoningEffort>; // 新增：模型 → 档位
  // ...
};

export const defaultConfig: AppConfig = {
  // ...
  thinkingModeEnabled: false,
  reasoningEffortByModel: {}, // 查不到时按最低档 low 处理
  // ...
};

// sanitizeConfig 内：逐项校验，丢弃空模型名 / 非白名单档位
function sanitizeReasoningEffortByModel(input: unknown): Record<string, ReasoningEffort> {
  const allowed: ReasoningEffort[] = ['low', 'high', 'max'];
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, ReasoningEffort> = {};
  for (const [model, effort] of Object.entries(input as Record<string, unknown>)) {
    const key = model.trim();
    if (key && allowed.includes(effort as ReasoningEffort)) out[key] = effort as ReasoningEffort;
  }
  return out;
}
// ...
reasoningEffortByModel: sanitizeReasoningEffortByModel(input?.reasoningEffortByModel),
```

### 2. agent/reasoning-params.ts（新增，零依赖）

```ts
import type { AppConfig, ReasoningEffort } from '../../shared/config';

export function isDeepSeekEndpoint(baseUrl: string) {
  try {
    return /(^|\.)deepseek\.com$/i.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

export function resolveModelEffort(config: AppConfig, model: string): ReasoningEffort {
  return config.reasoningEffortByModel?.[model] ?? 'low'; // 默认最低档
}

export type ReasoningRequestParams = {
  thinking?: { type: 'enabled' | 'disabled' };
  reasoning_effort?: ReasoningEffort;
};

export function buildReasoningParams(config: AppConfig): ReasoningRequestParams {
  const supported = !config.oneApiCompatibilityEnabled || isDeepSeekEndpoint(config.apiBaseUrl);
  if (!supported) return {};
  if (!config.thinkingModeEnabled) return { thinking: { type: 'disabled' } };
  return { thinking: { type: 'enabled' }, reasoning_effort: resolveModelEffort(config, config.model) };
}
```

（`isDeepSeekEndpoint` 由 `deepseek-client.ts` 迁入本模块并复用导出。）

### 3. deepseek-client.ts / buildRequestBody

```ts
const body: Record<string, unknown> = { model: config.model, messages: requestMessages, stream };
if (tools.length > 0) {
  body.tools = config.oneApiCompatibilityEnabled ? toOneApiCompatibleTools(tools) : tools;
}
Object.assign(body, buildReasoningParams(config)); // 顶层展开 thinking / reasoning_effort
return JSON.stringify(body);
```

移除原 `body.extra_body = { thinking: ... }` 分支及本文件内的 `isDeepSeekEndpoint`（改从 reasoning-params 导入）。

### 4. use-settings-state.ts

```ts
// saveConfigWithValues payload 追加：
reasoningEffortByModel: values.reasoningEffortByModel,

// 新增（仿 handleThinkingModeChange 的乐观更新 + 回滚）：
async function handleModelReasoningEffortChange(model: string, effort: ReasoningEffort) {
  const previous = formValues;
  const next = {
    ...previous,
    reasoningEffortByModel: { ...previous.reasoningEffortByModel, [model]: effort },
  };
  setFormValues(next);
  try { await saveConfigWithValues(next); }
  catch { setFormValues(previous); setSaveStatus('思考强度保存失败，请重试。'); }
}
```

同时 `settings-model.ts / normalizeConfigForm` 与 `config-form.ts / initialConfigForm` 补 `reasoningEffortByModel` 字段（初始 `{}`）。

### 5. Composer 模型下拉列表（每个模型项）

现状每个模型项是单个 `<button class="composer-model-option">`（`Composer.tsx:843-853`），改造为「一行两块」结构，避免 button 嵌套 button 的非法结构：

- 行容器 `composer-model-option-row`（`role="option"`）内：
  - 选择区按钮：模型名 + 档位徽标 `<span class="composer-model-effort-badge">{低/高/最大}</span>`（取 `reasoningEffortByModel[model] ?? 'low'`），点击 → `handleModelSelect(model)`。
  - 编辑图标按钮（`Pencil`）：默认 `opacity:0`，`.composer-model-option-row:hover` 时显示；`onClick` 先 `stopPropagation` 再打开该模型的档位弹层（本地 state `effortMenuModel`）。
- 档位弹层：低 / 高 / 最大 三项，点击某项 → `onModelReasoningEffortChange(model, effort)` 并关闭弹层。
- 新增 props：`reasoningEffortByModel`、`onModelReasoningEffortChange`；沿 `App.tsx → ConsolePanel → {ChatConsoleView, WorkflowConsoleView} → Composer` 逐层透传（与 `thinkingModeEnabled` 同链路）。

## 五、边界条件与异常处理

- **默认最低档**：任一模型未配置或配置非法时，`resolveModelEffort` 回落 `low`（用户指定的最低档）。
- **默认开启的关闭语义**：思考默认 ON，故关闭时必须显式发 `thinking:{type:'disabled'}`，否则关不掉——这是本次修复相对原逻辑的关键行为变化。
- **网关门控**：仅当 `!oneApiCompatibilityEnabled || isDeepSeekEndpoint` 时下发 thinking/effort；其余保持零下发（与当前行为一致）。
- **映射非法**：`sanitizeConfig` 逐项校验 `reasoningEffortByModel`，丢弃空模型名与非白名单档位，保证落盘干净。
- **HTML 结构**：模型项由「button 内含 span」改为「行容器含选择按钮 + 编辑按钮」，避免 button 嵌套；编辑图标点击须 `stopPropagation`，防止误触发选择模型。
- **Effort 生效范围**：`reasoning_effort` 仅在思考开启时随请求下发；per-model 配置始终可编辑并保存（即使当前思考关闭）。
- **思考模式采样限制**：DeepSeek 思考模式忽略 `temperature/presence_penalty/frequency_penalty`，`top_p` 下限 0.95——当前 `buildRequestBody` 未下发这些参数，无冲突，仅记录备忘。
- **持久化兼容**：老 `config.json` 无 `reasoningEffortByModel` 时，`sanitizeConfig` 自动补 `{}`，无需迁移脚本。

## 六、数据流路径

- 写入：模型项 hover → 点编辑图标 → 选择档位 → `onModelReasoningEffortChange(model, effort)` → `handleModelReasoningEffortChange`（App.tsx 接线）→ `saveConfigWithValues` → `desktopAppClient.saveConfig` → `config:save` IPC → `config-service.saveConfig` → 落盘 `config.json` 的 `reasoningEffortByModel`。
- 生效：`agentService.run` 载入 `config` → `createChatCompletionStream` → `buildRequestBody` → `buildReasoningParams(config)` → `resolveModelEffort(config, config.model)` → 顶层 `thinking` + `reasoning_effort` 发往 `/chat/completions`。
- 响应：模型返回 `reasoning_content`（流式 delta 与非流式均已在 `deepseek-client.ts:393-396 / 515` 处理），渲染层展示思考过程。

## 七、预期结果

- 思考模式开关真正生效：ON 时报文含顶层 `thinking:{type:'enabled'}` 且 `reasoning_content` 有内容；OFF 时含 `thinking:{type:'disabled'}` 且无思考输出。
- 模型下拉列表每个模型项名称后显示当前档位；hover 显示编辑图标，点击弹出「低 / 高 / 最大」选择列表，选择即持久化到该模型。
- 不同模型各自保存独立档位、重启后保留；未配置的模型默认最低档 `low`，随请求以顶层 `reasoning_effort` 下发。
- `npm run typecheck` 与 `npm test`（含新增 `reasoning-params.test.ts`）通过。
- 可在 `audit.log` 或抓包确认报文中 `thinking` 与 `reasoning_effort` 位于顶层且随开关 / 所选模型档位变化。

## 八、增量变更：按模型扩展思考强度档位

### 需求

DeepSeek V4 支持 low/high/max 三档；部分模型（如 Claude Opus 系列）支持五档 low/medium/high/xhigh/max（Anthropic `effort` 参数，OpenAI 兼容层同样经 `reasoning_effort` 传递）。要求**档位集合按模型区分**：五档模型可选全部档位，三档模型仍只见 low/high/max。

### 方案

1. `shared/config.ts` 的 `ReasoningEffort` 扩展为 `'low' | 'medium' | 'high' | 'xhigh' | 'max'`。
2. `shared/config.ts` 新增纯函数 `getModelEffortOptions(model: string): ReasoningEffort[]`：模型名匹配 `/opus/i` → 五档；其余（含 DeepSeek 全系）→ `['low', 'high', 'max']`。规则集中一处，便于后续按模型家族扩展。
3. `reasoning-params.ts` 的 `resolveModelEffort`：查表值不在该模型档位集合内时回落 `low`（集合都含 low），保证不会向不支持的网络关下发非法档位。
4. `sanitizeConfig` 白名单扩为五档；旧配置中的 low/high/max 均为合法子集，落盘天然兼容。
5. Composer：档位弹层改为按 `getModelEffortOptions(目标模型)` 动态渲染；label 映射补 `medium → Medium`、`xhigh → Extra High`；徽标沿用同一 label 映射。
6. 下发：`reasoning_effort` 原样发送所选档位（交互层已保证只会写入集合内的值）。

### 影响文件（增量）

| 文件 | 修改 |
|---|---|
| `e:\my-project\desktop-tools\src\shared\config.ts` | 类型扩展、白名单扩展、新增 `getModelEffortOptions` |
| `e:\my-project\desktop-tools\src\main\agent\reasoning-params.ts` | `resolveModelEffort` 增加集合校验回落 |
| `e:\my-project\desktop-tools\src\main\agent\reasoning-params.test.ts` | 补测试：opus 五档 / 默认三档 / 集合外回落 |
| `e:\my-project\desktop-tools\src\renderer\features\composer\Composer.tsx` | 弹层动态档位、label 映射扩展 |

### 边界

- 交互层保证只能选择该模型档位集合内的值；历史落盘值若在集合外，发送前回落 `low`。
- 三档模型不出现 medium/xhigh 选项，DeepSeek 网关不会收到非法值。
- `getModelEffortOptions` 放 shared 层（纯函数、零依赖），供主进程发送校验与 renderer 弹层渲染共用，符合依赖方向 renderer -> shared。
