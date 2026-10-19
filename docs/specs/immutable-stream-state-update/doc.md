# 以不可变状态更新修复流式文本重复追加

## 背景
当前 renderer 已为每轮 assistant 流式回复引入稳定消息 id，用于避免把新流错误拼到上一条 assistant 消息。但在实际调试中，`MessageList` 中打印出的 `body.text` 仍然出现内容级重复，例如 `学习学习 Rust Rust 可以从可以从...`。进一步排查表明，这不是展示层自行重复渲染同一文本，而是 `messages` state 中的 `assistant.content` 在流式累积时被重复追加。

## 问题场景与处理逻辑
### 场景 1：单个流式增量被重复拼接进同一条 assistant 消息
- 现状：`src/renderer/App.tsx` 中 `appendAssistantStreamDelta(...)` 先浅拷贝数组，再直接修改其中 assistant 消息对象的 `content`、`reasoning_content`、`content_started`。
- 风险：由于数组元素对象没有复制，state updater 不是纯函数，旧 state 对象会被原地污染。
- 结果：在 React 开发模式与 `StrictMode` 下，相同 updater 被重复演算时，同一 `deltaContent` 可能被拼接两次，表现为 `学习学习`、`Rust Rust` 等内容级重复。
- 目标：将流式消息累积改为不可变更新，只替换目标消息对象，不直接修改旧对象。

### 场景 2：调试日志显示 body 文本本身重复
- 现状：`MessageList.tsx` 中打印 `body` 时，日志内容已经是重复字符串。
- 原因：`body.text` 来源于 `message.content`，而 `message.content` 在上游 state 合并时已被错误地重复追加。
- 目标：修复 App 层状态更新后，`getMessageBodyModel(...)` 将自然得到正确的非重复文本，不需要修改展示层逻辑。

### 场景 3：保留现有流式身份与正文开始判断行为
- 现状：当前已引入 `streamMessageId` 和 `content_started`，分别用于稳定流式消息身份和在正文开始时立刻隐藏 reasoning bubble。
- 要求：本次修复不能破坏这两处既有行为。
- 目标：在不可变更新的前提下，保留现有 `streamMessageId` 定位消息、`content_started` 控制 reasoning/正文切换的逻辑。

## 架构与技术方案

### 核心修复点
仅调整 `src/renderer/App.tsx` 中的 `appendAssistantStreamDelta(...)`：
1. 若 `event.streamMessageId` 缺失，则直接返回 `currentMessages`
2. 若当前列表中不存在目标 assistant 消息，则创建一条新的 assistant 消息对象并追加到数组
3. 若存在目标消息，则不再原地修改 `assistantMessage`，而是基于旧对象创建一个新的 `updatedMessage`
4. 用新对象替换数组中对应位置
5. 返回新的消息数组

建议实现形态：
```ts
function appendAssistantStreamDelta(currentMessages: AgentMessage[], event: AgentStreamEvent) {
  if (!event.streamMessageId) {
    return currentMessages;
  }

  const assistantMessageIndex = currentMessages.findIndex((message) => message.id === event.streamMessageId);

  if (assistantMessageIndex === -1) {
    return [
      ...currentMessages,
      {
        id: event.streamMessageId,
        role: 'assistant',
        content: event.deltaContent ?? '',
        reasoning_content: event.deltaReasoningContent ?? '',
        content_started: event.deltaContent !== undefined,
      },
    ];
  }

  const targetMessage = currentMessages[assistantMessageIndex];
  if (targetMessage.role !== 'assistant') {
    return currentMessages;
  }

  const updatedMessage: AgentMessage = {
    ...targetMessage,
    content: `${targetMessage.content}${event.deltaContent ?? ''}`,
    reasoning_content: `${targetMessage.reasoning_content ?? ''}${event.deltaReasoningContent ?? ''}`,
    content_started: targetMessage.content_started === true || event.deltaContent !== undefined,
  };

  const nextMessages = [...currentMessages];
  nextMessages[assistantMessageIndex] = updatedMessage;
  return nextMessages;
}
```

### 为什么不移除 StrictMode
`src/renderer/main.tsx` 中启用了 `React.StrictMode`。它会放大不纯 state updater 的问题，但不是根因。
因此本次不通过去掉 `StrictMode` 掩盖问题，而是修复 `appendAssistantStreamDelta(...)` 的不可变更新行为。

### 为什么不改 MessageList
`src/renderer/features/messages/MessageList.tsx` 中的 `body` 只是读取 `message.content` 的结果，重复内容来自上游 state 数据，因此不需要在展示层添加规避逻辑。

## 受影响文件

### 1. `e:\other-code\desktop-tools\src\renderer\App.tsx`
- 修改流式消息状态合并逻辑
- 影响函数：`appendAssistantStreamDelta(...)`
- 修改类型：避免原地 mutation，改为不可变替换目标消息对象

### 2. `e:\other-code\desktop-tools\src\renderer\main.tsx`
- 本次不改代码，但需确认继续保留 `React.StrictMode`，以验证修复结果

### 3. `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`
- 本次不改业务逻辑
- 仅作为现象验证点，确认 `body.text` 不再出现 `学习学习` 这类重复字符串

## 数据流路径
1. 主进程通过 `agent:stream` 发出单次增量事件
2. preload 将事件透传给 renderer 的 `onAgentStream`
3. `App.tsx` 中 `setMessages((current) => appendAssistantStreamDelta(current, event))`
4. `appendAssistantStreamDelta(...)` 基于旧 state 生成新的目标 assistant 消息对象
5. `MessageList.tsx` 读取新的 `message.content` 并生成 `body.text`
6. 若状态更新纯净，则每个 delta 仅被拼接一次

## 边界条件与异常处理
- 若 `streamMessageId` 缺失，仍直接忽略该事件，避免错误更新其他消息
- 若命中的消息不是 assistant，返回原数组，保持保护逻辑
- 若仅有 `deltaReasoningContent` 没有 `deltaContent`，也需要正确生成新对象并累积 reasoning
- 若首次收到事件时目标消息尚不存在，需要一次性创建带初始 content/reasoning 的 assistant 消息，避免先创建空消息再 mutation

## 预期结果
- `MessageList` 中打印的 `body.text` 不再出现内容级重复，如 `学习学习`、`Rust Rust`
- 在开发模式且保留 `React.StrictMode` 的情况下，流式正文内容仍只会累积一次
- 不破坏现有 `streamMessageId` 消息定位机制
- 不破坏现有 `content_started` 导致的 reasoning -> 正文即时切换行为
- `npm run typecheck` 与 `npm run build` 继续通过
