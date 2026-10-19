# 智能体关联 Skill 运行时生效实现总结

## 完成内容

已让智能体编辑中关联的 `skillNames` 在运行时实际生效。

核心改动位于：

- `e:\other-code\desktop-tools\src\main\tool-registry.ts`

## 具体变更

1. 新增 `getAgentSkillNameSet(agentId?: string)`。
   - 未选择智能体时返回 `null`，表示不过滤用户 Skills。
   - 选择智能体但找不到详情时返回空集合，表示不暴露用户 Skills。
   - 选择有效智能体时读取 `agentProfilesService.getAgentDetail(agentId).skillNames` 并转为 Set。

2. 修改 `getUserTools(agentId?: string)`。
   - 原逻辑：无条件把所有已加载用户 Skills 暴露为 tools。
   - 新逻辑：
     - 无 `agentId`：继续暴露全部已加载用户 Skills。
     - 有 `agentId`：仅暴露该智能体 `skillNames` 中存在且当前已加载的 Skills。

3. 修改 `getRuntimeTools(agentId?: string)`。
   - 将 `agentId` 传入 `getUserTools(agentId)`。
   - 保持系统工具和 MCP 工具组合方式不变。

## 生效链路

- `agent-service.ts` 中 `getRegisteredToolsForAgent({ agentId })` 会通过过滤后的 `getRuntimeTools(agentId)` 生成模型可见 tools。
- `executeToolCall(toolCall, signal, { agentId })` 也会通过同一个 `getRuntimeTools(agentId)` 构建执行映射。
- 因此未关联的 Skill 不会暴露给模型，即使被请求执行也不会进入 `runtimeToolMap`。

## 行为结果

1. 未选择智能体：
   - 保持原行为，全部已加载用户 Skills 可用。

2. 选择智能体且关联了 Skills：
   - 只暴露该智能体关联的 Skills。

3. 选择智能体但未关联 Skills：
   - 不暴露用户 Skills。

4. 智能体不存在：
   - 不暴露用户 Skills，与 MCP 的安全默认行为一致。

5. 系统工具与 MCP：
   - 系统工具仍始终可用。
   - MCP 仍按 `mcp.enabledServerNames` 过滤，未改变原逻辑。

## 验证结果

已执行：

```bash
npm run typecheck
```

结果：通过，无 TypeScript 类型错误。
