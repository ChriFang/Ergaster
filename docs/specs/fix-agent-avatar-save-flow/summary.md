# 智能体头像保存与返回流程根因修复总结

## 完成内容

- 已将 `AgentProfileOperationResult.data` 从 `unknown` 收窄为 `AgentProfileDetail`。
- 已修复主进程保存成功返回值类型，避免 `null` 与可选 `data` 冲突。
- 已在 `AgentsPanel.tsx` 中新增保存结果到列表项的转换逻辑。
- 已新增智能体列表 upsert 和 `updatedAt` 排序逻辑。
- 创建或编辑保存成功后，会先使用返回的 detail 直接更新设置页列表和主侧栏 agents state。
- 保存成功后立即清空 `editingAgent` 和 `isCreating`，返回智能体管理列表。
- 保存后的 `loadAgents/loadMcpServers/loadSkills` 刷新改为非阻塞补偿流程，不再阻断返回列表。
- 保留 `AgentEditor.tsx` 中 `avatarColorRef` 与 state 同步逻辑，确保保存 payload 使用最新头像颜色。

## 修改文件

- `src/shared/agent-profile.ts`
  - `AgentProfileOperationResult.data` 改为可选 `AgentProfileDetail`。

- `src/main/agent-profiles-service.ts`
  - `createAgent()` 和 `updateAgent()` 返回 `this.getAgentDetail(id) ?? undefined`，匹配收窄后的结果类型。

- `src/renderer/features/agents/AgentsPanel.tsx`
  - 新增 `toAgentListItem()`。
  - 新增 `sortAgentsByUpdatedAt()`。
  - 新增 `upsertAgentListItem()`。
  - `handleSave()` 改为统一处理 create/update 结果。
  - 保存成功后直接同步本地列表和主侧栏列表。
  - 保存成功后立即退出编辑态。
  - 保存后刷新改为后台补偿流程。

- `.comate/specs/fix-agent-avatar-save-flow/tasks.md`
  - 5 个顶层任务已全部勾选完成。

## 验证结果

- `npm run typecheck`：首次发现主进程返回值 `null` 类型问题，修复后通过。
- `npm run build`：通过。

## 行为结果

- 编辑已有智能体并切换头像色块后，保存成功会立即回到智能体管理列表。
- 设置页智能体列表会直接使用保存返回的头像颜色更新。
- 主界面侧栏智能体列表会同步接收最新头像颜色。
- 保存失败时仍停留编辑界面并显示错误。
