# 智能体保存返回与头像颜色最终修复总结

## 完成内容

- 已删除 `AgentsPanel.handleSave()` 中保存后的 `void Promise.all([loadAgents(), loadMcpServers(), loadSkills()])`。
- 删除原因：该异步调用内部 `loadAgents()` 修改 `loading` state，与 `setEditingAgent(null)` 产生竞态，导致渲染不稳定。保存后列表已通过 `result.data` 直接更新，无需依赖全量重载。
- 已删除 `AgentEditor.handleSave()` 中 `await onSave()` 后的 `onCancel()` 调用。
- 删除原因：父组件 `handleSave` 中已通过 `setEditingAgent(null)` 触发界面切换，重复调用 `onCancel()` 导致双重状态变更产生竞争。
- 保留用保存返回 `result.data` 直接 upsert 本地列表和同步侧栏的逻辑。

## 修改文件

- `src/renderer/features/agents/AgentsPanel.tsx`
  - 删除 `handleSave()` 中保存后的 `void Promise.all([loadAgents()...])` 调用。
  - 保留 `result.data` upsert 列表和 `onAgentsChanged` 同步。
  - 保留 `setEditingAgent(null)` + `setIsCreating(false)`。

- `src/renderer/features/agents/AgentEditor.tsx`
  - 删除 `handleSave()` 中 `await onSave()` 后的 `onCancel()` 调用。
  - 界面返回完全由父组件 `setEditingAgent(null)` 触发。

- `.comate/specs/fix-agent-save-remove-redundant-reload/tasks.md`
  - 3 个顶层任务已全部勾选完成。

## 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过。

## 行为结果

- 保存成功后：父组件 `handleSave` 中 `setEditingAgent(null)` 无其他竞争状态，直接切换到列表视图。
- 列表更新：`result.data` 包含主进程返回的最新 `avatarColor`，已直接 upsert 到本地 `agents` state 和侧栏。
- 保存失败：仍抛错给 AgentEditor 的 catch，展示错误，不退出编辑器。
