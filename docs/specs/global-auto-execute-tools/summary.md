# 工具自动执行清单全局化 - 任务总结

## 完成概览

6 个任务全部完成，`npm run typecheck` 通过，`npm test` 400/400 通过。「允许自动执行的工具」已从按智能体改为全局设置，归口「工具设置」tab。

## 实现内容

### 1. 配置模型（src/shared/config.ts）
- `ToolSettings` 新增 `autoExecuteTools?: string[]`，用 `sanitizeStringArray` 清洗。

### 2. 判定逻辑
- `auto-execute.ts`：`shouldAutoExecute(tool, autoExecuteTools: string[] | undefined, hasWorkflowMeta)` 改读全局清单，保留 workflowMeta 与 high 守卫；`auto-execute.test.ts` 按新签名重写。
- `tool-registry.ts`：executeToolCall 起始统一 `const toolSettings = (await loadConfig()).toolSettings ?? {}`，命令白名单与自动执行清单共用（去掉重复 loadConfig）；移除 `agentDetailForAutoExecute`，判定改读 `toolSettings.autoExecuteTools`。

### 3. 确认卡「记住」写全局
- `config-service.ts` 新增 `appendAutoExecuteTool(toolName)`（去重落盘）。
- `tool-registry.ts`：`outcome.autoRun` 改调 `appendAutoExecuteTool`，移除 `agentProfilesService.addAutoExecuteTool` 调用与确认请求里的 `agentId`。
- `shared/tools.ts`：`ToolConfirmationRequest` 删除 `agentId`。
- `ConfirmationPanel.tsx`：文案「当前智能体」→「全局」。

### 4. agent 侧彻底移除
- `shared/agent-profile.ts`：四处删除 `autoExecuteTools`。
- `agent-profiles-service.ts`：删 `normalizeAutoExecuteTools`、`addAutoExecuteTool`，及 create/update/parseMetadata/getAgentDetail/list/默认种子各处字段。
- `AgentEditor.tsx`：删除 state/toggle/handleSave 字段、`availableTools` prop 与「允许自动执行的工具」UI 区块。
- `AgentsPanel.tsx`：删除 `availableTools` 加载与透传、AgentDraft 类型/默认值/create+update payload 中的字段。

### 5. 工具设置 tab 新增多选 UI
- `ToolsSettingsPanel.tsx`：组件内 `listSystemToolCatalog()` 加载目录，新增「允许自动执行的工具」chip 列表（medium 可勾、low/high 禁用并标注），toggle 更新 `formValues.toolSettings.autoExecuteTools`。
- `config-form.ts` / `settings-model.ts` / `use-settings-state.ts`：同步新字段。

## 行为变化

| 场景 | 之前 | 现在 |
|---|---|---|
| 配置自动执行工具 | 每个智能体编辑器各自配置 | 工具设置 tab 全局配置一次，所有智能体生效 |
| 确认卡「记住」 | 写入当前智能体 `agent.json` | 写入全局 `config.json`，对所有会话生效 |
| 原各 agent 旧配置 | 生效 | 丢弃（choice A），旧 agent.json 字段成死数据，不读不写 |
| high 工具 / workflow / 无人值守 | 强制弹窗 / 不自动执行 | 不变 |

## 遗留

- 手动冒烟（6.3）需在应用内验证：工具设置勾选工具后对默认及其它 agent 均免确认；确认卡勾「记住（全局）」后重开设置可见；AgentEditor 不再有该区块。
- 旧 `agent.json` 里残留的 `autoExecuteTools` 键为无害死数据，下次保存该 agent 时自动不再写入。
