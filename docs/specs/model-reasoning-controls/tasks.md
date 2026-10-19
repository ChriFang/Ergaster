# 思考模式修复 + 按模型 Reasoning Effort 配置 任务计划

- [✓] Task 1: 扩展 shared/config.ts 配置模型
    - 1.1: 新增并导出 `ReasoningEffort` 类型（`'low' | 'high' | 'max'`）
    - 1.2: `AppConfig` 增加 `reasoningEffortByModel: Record<string, ReasoningEffort>`
    - 1.3: `defaultConfig` 增加 `reasoningEffortByModel: {}`
    - 1.4: 新增 `sanitizeReasoningEffortByModel` 并在 `sanitizeConfig` 调用（丢弃空模型名 / 非白名单档位）

- [✓] Task 2: 新增 agent/reasoning-params.ts 纯逻辑模块（零依赖）
    - 2.1: 迁入并导出 `isDeepSeekEndpoint`
    - 2.2: 实现并导出 `resolveModelEffort(config, model)`（查不到回落 `low`）
    - 2.3: 定义 `ReasoningRequestParams` 类型
    - 2.4: 实现并导出 `buildReasoningParams(config)`（网关门控 + enabled/disabled + effort）

- [✓] Task 3: 补充单测并接入测试管线
    - 3.1: 新增 `agent/reasoning-params.test.ts`：覆盖默认 low / 显式档位 / 思考关闭 disabled / 非 DeepSeek+oneApi 零下发
    - 3.2: 在 package.json `test` 脚本两处列表（esbuild 打包 + node --test 运行）登记新测试文件
    - 3.3: 运行 `npm test` 确认新测试通过

- [✓] Task 4: 修复 deepseek-client.ts 请求构建（子需求 A 核心）
    - 4.1: `buildRequestBody` 改为 `Object.assign(body, buildReasoningParams(config))`，顶层展开 thinking / reasoning_effort
    - 4.2: 删除原 `body.extra_body = { thinking }` 分支
    - 4.3: 删除本文件内 `isDeepSeekEndpoint`，改从 reasoning-params 导入
    - 4.4: 运行 `npm run typecheck` 确认主进程编译通过

- [✓] Task 5: 打通渲染层配置读写
    - 5.1: `config-form.ts` 的 `initialConfigForm` 增 `reasoningEffortByModel: {}`
    - 5.2: `settings-model.ts` 的 `normalizeConfigForm` 透传 `reasoningEffortByModel`
    - 5.3: `use-settings-state.ts` 的 `saveConfigWithValues` payload 追加 `reasoningEffortByModel`
    - 5.4: `use-settings-state.ts` 新增并导出 `handleModelReasoningEffortChange(model, effort)`

- [✓] Task 6: 改造 Composer 模型下拉列表项交互
    - 6.1: 新增 props `reasoningEffortByModel`、`onModelReasoningEffortChange` 及类型定义
    - 6.2: 模型项改为行容器结构（选择按钮 + 档位徽标 + hover 编辑图标），避免 button 嵌套
    - 6.3: 新增本地 state `effortMenuModel`；编辑图标点击 `stopPropagation` 后打开该模型档位弹层
    - 6.4: 档位弹层（低 / 高 / 最大）选择 → 调 `onModelReasoningEffortChange` 并关闭
    - 6.5: 新增对应样式（档位徽标、hover 显隐编辑图标、弹层定位）

- [✓] Task 7: 逐层透传 props 接线
    - 7.1: `ConsolePanel.tsx` 增加并透传两个 prop
    - 7.2: `ChatConsoleView.tsx` 增加并透传
    - 7.3: `WorkflowConsoleView.tsx` 增加并透传
    - 7.4: `App.tsx` 从 `useSettingsState` 取值接线到 `ConsolePanel`

- [✓] Task 8: 整体验证
    - 8.1: 运行 `npm run typecheck` 全量通过
    - 8.2: 运行 `npm test` 全量通过
    - 8.3: 自查报文：思考 ON → 顶层 `thinking.enabled` + `reasoning_effort`=所选模型档位；OFF → `thinking.disabled`；切换模型档位即时持久化

- [✓] Task 9: 扩展档位类型与按模型档位集合（shared/config.ts）
    - 9.1: `ReasoningEffort` 扩展为 `'low' | 'medium' | 'high' | 'xhigh' | 'max'`
    - 9.2: `sanitizeReasoningEffortByModel` 白名单同步扩为五档
    - 9.3: 新增并导出 `getModelEffortOptions(model)`：`/opus/i` → 五档；其余 → `['low', 'high', 'max']`

- [✓] Task 10: 主进程发送校验与测试
    - 10.1: `resolveModelEffort` 查表值不在该模型档位集合内时回落 `low`
    - 10.2: reasoning-params.test.ts 补 3 例（opus 五档 / 默认三档 / 集合外回落）
    - 10.3: 运行 `npm test` 通过

- [✓] Task 11: Composer 档位弹层按模型动态渲染
    - 11.1: label 映射补 `medium → Medium`、`xhigh → Extra High`，移除固定 `REASONING_EFFORT_OPTIONS`
    - 11.2: 档位弹层改用 `getModelEffortOptions(effortMenuModel)` 动态渲染选项
    - 11.3: 运行 `npm run typecheck` 通过
