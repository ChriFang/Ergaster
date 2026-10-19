# 修复会话记录相互覆盖总结

## 完成内容

### 1. 主进程会话存储改为按上下文隔离
- 在 `src/main/agent-service.ts` 中新增默认会话键 `default`。
- 将单一 `messages` 数组改为 `messagesByConversation` 映射表。
- 新增按 `agentId` 解析会话键的方法，使默认模式和各智能体分别维护独立消息历史。
- `run`、`getMessages`、`reset` 已改为仅作用于当前上下文。

### 2. IPC 与类型定义已支持会话上下文参数
- 在 `src/shared/agent.ts` 中新增 `AgentConversationScope` 类型。
- 在 `src/shared/contracts.ts` 中更新 `DesktopAppApi`，使 `resetAgent`、`getAgentMessages` 支持可选上下文参数。
- 在 `src/main/index.ts` 中透传 `agent:reset`、`agent:get-messages` 的上下文参数。
- 在 `src/preload/index.ts` 中同步更新桥接 API。

### 3. 渲染层切换智能体时按当前上下文加载消息
- 在 `src/renderer/App.tsx` 中新增 `toConversationScope`、`loadConversationMessages`、`handleAgentSelection`。
- 页面初始化默认加载默认模式会话。
- 用户切换默认模式/具体智能体时，会立即刷新为对应上下文的聊天记录。
- 运行失败后的快照回读已携带当前 `agentId`。
- “重置会话”现在只重置当前模式对应的消息。
- 当当前选中智能体被删除时，会回退到默认模式并刷新默认模式消息。

## 验证结果
- 已执行：`npm run typecheck`
- 结果：通过

## 本次修复后的行为
1. 默认模式与各智能体之间的聊天消息彼此独立。
2. 智能体 A 与智能体 B 之间切换时，不再共享同一份历史消息。
3. 重置会话只影响当前选中的模式。
4. 发送失败后回读的仍是当前上下文消息，不会跳到其他会话。

## 未纳入本次修改的范围
- 聊天消息仍未做磁盘持久化，应用重启后会话不会保留。
- 输入记录 `chat-history` 仍是全局去重策略，未按智能体拆分。
- 未引入更细粒度的多 session 管理，仅修复当前默认模式与智能体之间的会话隔离问题。