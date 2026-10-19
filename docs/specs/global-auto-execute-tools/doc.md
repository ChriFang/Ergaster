# 工具自动执行清单全局化（global-auto-execute-tools）

## 1. 背景与目标

当前「允许自动执行的工具」(`autoExecuteTools`) 按**智能体**存储于 `agent.json`，判定走 `auto-execute.ts:shouldAutoExecute(tool, agentDetail, hasWorkflowMeta)`，设置入口在 AgentEditor，并由确认卡「自动运行并记住（当前智能体）」写入对应 agent。

目标：将其改为**全局设置**，与命令白名单一致，统一归口「工具设置」tab，不再绑定单个智能体。

决策（用户已确认）：
- 迁移策略 **A（丢弃）**：现有各 agent 的 `autoExecuteTools` 不迁移，用户在工具设置里重新配置。
- 从 `agent.json` 及相关类型/服务/编辑器中**彻底移除** `autoExecuteTools` 字段（遵循删除未用代码原则）。

定位不变：仅系统工具（`source.type === 'system'`）且非 high 风险可被加入；high 风险工具（`run_command`、`install_skill` 等）即使被配进清单也强制弹窗；workflow / 子智能体链路（带 `workflowMeta`）一律不走自动执行清单。

## 2. 配置模型变更（src/shared/config.ts）

`ToolSettings` 新增字段：

```ts
export type ToolSettings = {
  allowedPaths?: string[];
  searchRoots?: string[];
  draftDirectory?: string;
  commandAllowlist?: string[];
  commandDenylist?: string[];
  /** 全局「允许自动执行的工具」清单：命中的系统工具（非 high）调用不再弹确认卡。存工具名原样（小写标识符）。 */
  autoExecuteTools?: string[];
};
```

- sanitize：复用 `sanitizeStringArray`（trim + 过滤空值）即可；工具名是固定小写标识符，不做大小写转换。
- 默认空数组；安全基线由"仅系统非 high 工具可配 + high 强制弹窗"保证。

## 3. 判定逻辑变更

### auto-execute.ts
`shouldAutoExecute` 不再接收 agentDetail，改为接收全局清单：

```ts
export function shouldAutoExecute(
  tool: AutoExecuteCandidate,
  autoExecuteTools: string[] | undefined,
  hasWorkflowMeta: boolean,
): boolean {
  if (hasWorkflowMeta) return false;      // workflow / 子智能体链路不走清单
  if (tool.risk === 'high') return false; // high 强制弹窗（双保险）
  return (autoExecuteTools ?? []).includes(tool.name);
}
```
`resolveUnattendedApproval` 不变。

### tool-registry.ts（executeToolCall）
- 在 try 块起始统一 `const toolSettings = (await loadConfig()).toolSettings ?? {}`，供命令白名单与本清单共用（去掉 run_command 分支里重复的 loadConfig）。
- 移除 `agentDetailForAutoExecute = agentProfilesService.getAgentDetail(...)`，`autoApproved` 中改为 `shouldAutoExecute({ name, risk }, toolSettings.autoExecuteTools, Boolean(options?.workflowMeta))`。
- 行为保持：workflow 仍不自动执行（hasWorkflowMeta 守卫）、high 仍强制弹窗。

## 4. 确认卡「记住」写入全局

- tool-registry：`outcome.autoRun` 分支由 `agentProfilesService.addAutoExecuteTool(agentId, tool.name)` 改为 `appendAutoExecuteTool(tool.name)`（config-service 新增，去重并落盘，走 saveConfig sanitize）。
- `canAutoRun` 门控不变：`(tool.source?.type ?? 'system') === 'system' && tool.risk !== 'high'`。
- ConfirmationPanel.tsx：「自动运行并记住（当前智能体）」文案改为「自动运行并记住（全局）」。
- `ToolConfirmationRequest.agentId` 改为仅此前用于 addAutoExecuteTool；移除后该字段无其它消费方，一并从 shared/tools.ts 的类型与 tool-registry 的请求构造中删除。

## 5. agent 侧移除

- `src/shared/agent-profile.ts`：从 `AgentProfileMetadata`、`CreateAgentProfileRequest`、`UpdateAgentProfileRequest`、`AgentProfileDetail` 四处删除 `autoExecuteTools`。
- `src/main/agent-profiles/agent-profiles-service.ts`：删 `normalizeAutoExecuteTools`、`addAutoExecuteTool`；createAgent 默认值、updateAgent、parseMetadata、getAgentDetail / list 的 spread 全部移除该字段。旧 `agent.json` 里残留的 `autoExecuteTools` 键不再读取，下次保存时自然不再写入（choice A = 丢弃，无迁移脚本）。
- `src/renderer/features/agents/AgentEditor.tsx`：删除 `autoExecuteTools` state、`toggleAutoExecuteTool`、handleSave 字段、`availableTools` prop 与「允许自动执行的工具」整块 UI（约 256-288 行）。
- `src/renderer/features/agents/AgentsPanel.tsx`：删除 `availableTools` state 与 `listSystemToolCatalog()` 加载、传给 AgentEditor 的 prop、AgentDraft 类型/默认值/create+update payload 中的 `autoExecuteTools`。

## 6. 工具设置 tab 新增工具多选 UI（ToolsSettingsPanel.tsx）

- 新增「允许自动执行的工具」区块，复用原 AgentEditor 的交互：工具目录来自 `window.desktopApp.listSystemToolCatalog()`（组件内 useEffect 加载到本地 state）。
- 选中集 = `formValues.toolSettings?.autoExecuteTools ?? []`；点击切换经 `onChange` 更新 `formValues.toolSettings.autoExecuteTools`。
- 门控展示：仅 `risk === 'medium'` 可勾选；low 显示「（默认放行）」、high 显示「（高危不支持）」且禁用——与原 AgentEditor 文案一致。
- 保存走 `handleSaveConfig`；`use-settings-state.saveConfigWithValues` 的 payload.toolSettings 增 `autoExecuteTools: values.toolSettings?.autoExecuteTools ?? []`。该字段是直接存于 formValues 的 toggle 列表，无需像命令白名单那样的文本框同步。

## 7. 受影响文件清单

| 文件 | 改动 |
|---|---|
| src/shared/config.ts | ToolSettings 增 autoExecuteTools；sanitize 扩展 |
| src/shared/tools.ts | ToolConfirmationRequest 删除 agentId |
| src/shared/agent-profile.ts | 四处删除 autoExecuteTools 字段 |
| src/main/tools/auto-execute.ts | shouldAutoExecute 改收全局清单 |
| src/main/tools/auto-execute.test.ts | 按新签名重写用例 |
| src/main/tools/tool-registry.ts | 统一 loadConfig；判定改读全局；记住写 appendAutoExecuteTool；删 agentId 构造 |
| src/main/core/config-service.ts | 新增 appendAutoExecuteTool(toolName) |
| src/main/agent-profiles/agent-profiles-service.ts | 删 normalize/add 与各处字段 |
| src/renderer/features/confirmation/ConfirmationPanel.tsx | 文案改「全局」 |
| src/renderer/features/agents/AgentEditor.tsx | 删「允许自动执行的工具」区块与相关 state/prop |
| src/renderer/features/agents/AgentsPanel.tsx | 删 catalog 加载与字段透传 |
| src/renderer/features/settings/ToolsSettingsPanel.tsx | 新增工具多选区块 + catalog 加载 |
| src/renderer/config-form.ts | initialConfigForm.toolSettings 增 autoExecuteTools: [] |
| src/renderer/features/settings/settings-model.ts | normalizeConfigForm 增 autoExecuteTools |
| src/renderer/lib/hooks/use-settings-state.ts | saveConfigWithValues payload 增 autoExecuteTools |

## 8. 边界与测试

- workflow / 子智能体链路：维持不自动执行（hasWorkflowMeta 守卫）。
- 无人值守（定时任务）：维持 `resolveUnattendedApproval`，high 拒绝、low/medium 放行，不受本清单影响。
- high 风险工具：即使被写入清单也强制弹窗。
- 向后兼容：旧 agent.json 的 autoExecuteTools 变为死数据，不读不写；全局 config 无该字段时回退空清单。
- 验证：`npm run typecheck` + `npm test`（重写 auto-execute 用例并保持全绿）。

## 9. 预期结果

- 「允许自动执行的工具」从智能体编辑器消失，迁移到「工具设置」tab，作用于所有智能体。
- 确认卡勾选「自动运行并记住（全局）」后写入全局清单，对所有会话/智能体生效。
- 原各 agent 的旧配置被丢弃，用户在工具设置里重配一次即可。



