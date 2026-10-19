# 稳定流式消息身份以消除重影渲染总结

## 完成情况
已完成 `tasks.md` 中全部 3 项任务，核心目标是让流式 assistant 消息在主进程、跨进程事件、renderer 临时态和最终快照之间共享稳定身份，避免依赖“最后一条 assistant”与 `role-index` key 造成的错误节点复用与文本重影观感。

## 实际改动

### 1. 扩展共享消息类型
文件：`e:\other-code\desktop-tools\src\shared\agent.ts`
- 为 `AgentMessage` 增加 `id?: string`
- 为 `AgentStreamEvent` 增加 `streamMessageId?: string`

效果：renderer 可以明确知道某个流式 delta 属于哪条 assistant 消息，而不是继续依赖位置推断。

### 2. 主进程为每轮 assistant 流建立稳定身份
文件：`e:\other-code\desktop-tools\src\main\agent-service.ts`
- `toPublicMessages(...)` 现在会透传 `message.id`
- 新增 `createMessageId(...)` 用于生成稳定消息 id
- 用户消息入会话时附带 `id`
- 每轮 assistant 流开始前生成 `assistantMessageId`
- 每个 stream 事件都会携带 `streamMessageId`
- assistant 最终写入 `workingMessages` 时复用同一个 `assistantMessageId`

效果：同一轮 assistant 的流式中间态与最终完整消息共享同一个身份。

### 3. renderer 按消息 id 累积流式 delta
文件：`e:\other-code\desktop-tools\src\renderer\App.tsx`
- 重写 `appendAssistantStreamDelta(...)`
- 改为按 `event.streamMessageId` 查找已有消息
- 未命中时才创建新的临时 assistant 消息
- 事件缺少 `streamMessageId` 时直接忽略，不再退回“最后一条 assistant”模式
- 保留 `content_started` 行为，继续用于 reasoning -> 正文的立即切换

效果：新的流不会误拼接到上一条 assistant 回复，降低相近文本叠画概率。

### 4. 稳定消息列表 key
文件：`e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts`
- `getMessageKey(...)` 改为优先使用 `message.id`
- 旧数据没有 `id` 时仍回退到原来的索引 key

效果：流式临时消息与最终快照替换时，React 可以基于稳定 key 更准确地维护节点身份。

## 验证结果
已完成：
- `npm run typecheck`
- `npm run build`

结果：全部通过。

## 预期收益
- 减少 reasoning/正文切换时的白色重影与叠字观感
- 避免多轮 assistant/tool/assistant 场景中把新流错误接到旧 assistant 消息上
- 让流式临时态与最终快照在 React 层使用同一消息身份，减少错误 DOM 复用
