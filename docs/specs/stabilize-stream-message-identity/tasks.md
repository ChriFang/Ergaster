# 稳定流式消息身份以消除重影渲染任务计划
- [x] Task 1: 扩展共享消息类型并为主进程流式消息建立稳定身份
    - 1.1: 在 `src/shared/agent.ts` 为 `AgentMessage` 增加 `id`、为 `AgentStreamEvent` 增加 `streamMessageId`
    - 1.2: 在 `src/main/agent-service.ts` 为每轮 assistant 流生成稳定消息 id
    - 1.3: 在主进程 stream 事件透传 `streamMessageId`，并在最终 public messages 中保留相同 `id`

- [x] Task 2: 按消息 id 重构 renderer 的流式累积逻辑
    - 2.1: 在 `src/renderer/App.tsx` 重写 `appendAssistantStreamDelta(...)`，按 `streamMessageId` 查找或创建目标 assistant 消息
    - 2.2: 移除依赖“最后一条 assistant”承接 delta 的逻辑，避免错误拼接到上一条回复
    - 2.3: 保留现有 `content_started` 行为，使 reasoning 到正文的切换仍然立即生效

- [x] Task 3: 稳定消息列表 key 并完成回归验证
    - 3.1: 在 `src/renderer/features/messages/message-model.ts` 让 `getMessageKey(...)` 优先使用 `message.id`
    - 3.2: 检查 `MessageList` 在流式中间态与最终快照替换时的渲染一致性
    - 3.3: 运行 `npm run typecheck` 与 `npm run build`，确认改动未引入类型或构建问题
