# 流式气泡切换抖动修复总结

## 已完成内容

### 1. 合并单个流式 delta 的事件分发
- 在 `e:\other-code\desktop-tools\src\main\deepseek-client.ts` 中调整了流式 chunk 处理逻辑。
- 现在同一个 delta 中如果同时包含 `reasoning_content` 和 `content`，会先聚合到同一个 `ChatCompletionStreamEvent`，再统一调用一次 `onChunk(...)`。
- 保持了 `tool_calls` 聚合逻辑不变，没有影响工具调用链路。

### 2. 提前正文开始判定
- 在 `e:\other-code\desktop-tools\src\shared\agent.ts` 中为 `AgentMessage` 增加了前端展示辅助字段 `content_started?`。
- 在 `e:\other-code\desktop-tools\src\renderer\App.tsx` 的流式 assistant 临时消息中初始化并维护该字段。
- 一旦收到任何 `deltaContent`，即使只是空白字符，也会将 `content_started` 设为 `true`。
- 在 `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx` 中，assistant 气泡切换逻辑改为优先依据 `content_started` 判断正文是否已经开始。

### 3. 修复效果
- 减少了同一个后端 chunk 被拆成两次前端 `setMessages(...)` 的情况。
- 思考气泡与正文气泡的切换更接近一次原子更新。
- 避免因为正文首个 delta 是空格/换行而让思考气泡继续停留。

## 验证结果

### 类型检查
已执行：`npm run typecheck`

结果：通过。

### 构建验证
已执行：`npm run build`

结果：通过。

## 影响文件
- `e:\other-code\desktop-tools\src\main\deepseek-client.ts`
- `e:\other-code\desktop-tools\src\shared\agent.ts`
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`

## 结果说明

当前修复针对的是“流式切换抖动/闪叠”的主要来源：
- 同 chunk 多次事件分发
- 正文开始判定偏晚

修复后，独立思考气泡在正文开始时会更及时隐藏，流式短文本的闪叠感应明显减轻。