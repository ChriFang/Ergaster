# 思考模式修复 + 按模型 Reasoning Effort 配置 实施总结

## 背景与调查结论

### 子需求 A：思考模式开关此前不可用
- 开关 UI → 配置 → 请求全链路已接通，但 `deepseek-client.ts` 把 `thinking` 参数包在 `extra_body` 里下发。
- `extra_body` 是 OpenAI SDK 的客户端约定（SDK 会把它展开到请求体顶层）；本项目手拼 JSON 直发，导致报文出现顶层 `extra_body` 字段被 DeepSeek 网关静默丢弃，思考指令从未生效。
- 叠加 DeepSeek V4 思考模式默认开启，开关在开/关两个方向都成了空操作。

### 子需求 B：思考强度（Reasoning Effort）
- DeepSeek V4-Pro/V4-Flash 支持 low/high/max 三档，经顶层 `reasoning_effort` 设置；此前应用完全不下发。
- 按用户要求实现为「按模型独立配置、落盘持久化、默认最低档 low、在模型列表内 hover 编辑」。

## 主要改动

### 主进程 / 共享层
- `src/shared/config.ts`：新增 `ReasoningEffort` 类型；`AppConfig` 增 `reasoningEffortByModel` 映射；`defaultConfig` 置 `{}`；新增 `sanitizeReasoningEffortByModel` 逐项校验。
- `src/main/agent/reasoning-params.ts`（新增，零依赖）：`isDeepSeekEndpoint`、`resolveModelEffort`（默认 low）、`buildReasoningParams`（网关门控 + enabled/disabled + effort）。
- `src/main/agent/deepseek-client.ts`：`buildRequestBody` 改为 `Object.assign(body, buildReasoningParams(config))`，顶层展开 thinking/reasoning_effort；删除 `extra_body` 分支与本地 `isDeepSeekEndpoint`。

### 渲染层
- `config-form.ts` / `settings-model.ts` / `use-settings-state.ts`：配置读写补 `reasoningEffortByModel`；新增 `handleModelReasoningEffortChange`（乐观更新 + 失败回滚）。
- `Composer.tsx`：模型下拉列表项改为行容器——模型名 + 档位徽标 + hover 编辑图标，点击弹出「低 / 高 / 最大」档位选择弹层；新增本地 state 与两个 props。
- `styles.css`：新增档位徽标、hover 编辑图标、档位弹层样式。
- 逐层透传 `reasoningEffortByModel` / `onModelReasoningEffortChange`：`App.tsx → ConsolePanel → {ChatConsoleView, WorkflowConsoleView} → Composer`。

### 测试
- 新增 `src/main/agent/reasoning-params.test.ts`（7 例），并登记进 `package.json` 两处测试列表（esbuild 打包 + node --test 运行）。

## 验证结果
- `npm run typecheck`：通过。
- `npm test`：347 例全部通过（含新增 7 例）。
- 关键行为（单测覆盖）：思考 ON → 顶层 `thinking:{type:'enabled'}` + 所选模型 `reasoning_effort`；OFF → `thinking:{type:'disabled'}`；未配置模型默认 `low`；非 DeepSeek + OneAPI 兼容零下发。

## 备注
- 思考模式默认开启机制下，本次通过显式下发 `disabled` 才能真正关闭思考。
- DeepSeek 思考模式忽略 `temperature/presence_penalty/frequency_penalty`，`top_p` 下限 0.95；当前请求未下发这些参数，无冲突。
- 运行态可在 `audit.log` 或抓包核对报文中 `thinking` / `reasoning_effort` 位于顶层，且随开关与所选模型档位变化。

## 增量变更：按模型扩展思考强度档位

- `ReasoningEffort` 扩展为五档 `low / medium / high / xhigh / max`；`sanitizeConfig` 白名单同步扩展（旧配置值均为合法子集，落盘兼容）。
- `shared/config.ts` 新增 `getModelEffortOptions(model)`：`/opus/i` → 五档；其余（含 DeepSeek 全系）→ 三档 low/high/max；规则集中一处便于扩展。
- `resolveModelEffort` 发送前校验：查表值不在该模型档位集合内时回落 `low`，保证 DeepSeek 网关不会收到 `medium/xhigh`。
- Composer 档位弹层改为按 `getModelEffortOptions(目标模型)` 动态渲染；label 映射补 `Medium` / `Extra High`（英文显示，与既有文案一致）。
- 过程中的 UI 微调（用户反馈驱动）：档位文案改英文、弹出式档位菜单（锚定编辑按钮上方、避开列表裁剪）、档位文本去胶囊背景、名称与档位间距收紧、选中模型在 trigger 上同样显示档位。
- 验证：`npm run typecheck` 通过；`npm test` 350 例全过（含新增 3 例：opus 五档 / 默认三档 / 集合外回落）。
