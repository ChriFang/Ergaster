# 流式气泡切换抖动修复设计

## 需求背景

当前已经将 `reasoning_content` 改为独立思考气泡显示，并在正文 `content` 开始输出后隐藏思考气泡。但实际体验中仍会看到短暂的重叠/闪叠感。

进一步排查后确认，主要问题不是同一帧里同时渲染两个气泡，而是：
- 主进程会把同一个流式 chunk 中的 `reasoning_content` 与 `content` 分两次发给前端
- 前端对每次事件都立即 `setMessages(...)`
- 这样会导致 reasoning 气泡先出现，再在极短时间内切成正文气泡，形成明显的切换抖动

此外，正文开始的判定当前依赖 `message.content.trim().length > 0`，如果最先收到的是空格或换行，思考气泡会比预期停留更久，也会放大视觉问题。

本次改造目标是按排查结论修复：
1. 合并同一 chunk 的 reasoning/content 增量，尽量让前端一次状态更新完成切换
2. 将“正文已开始”判定提前，只要收到任何 content 增量就认为正文开始

## 现状分析

### 当前主进程流式转发问题

`e:\other-code\desktop-tools\src\main\deepseek-client.ts:164`
当前在解析单个流式 delta 时：

```ts
if (delta.reasoning_content) {
  reasoningContent += delta.reasoning_content;
  onChunk({ deltaReasoningContent: delta.reasoning_content });
}

if (delta.content) {
  content += delta.content;
  onChunk({ deltaContent: delta.content });
}
```

若同一个 chunk 同时带有 `reasoning_content` 和 `content`，这里会向上游发出两次 `onChunk`。

### 当前前端流式更新问题

`e:\other-code\desktop-tools\src\renderer\App.tsx:108`
前端对每个流式事件都立即执行：

```ts
setMessages((current) => appendAssistantStreamDelta(current, event));
```

而 `appendAssistantStreamDelta(...)` 又会把两个字段写到同一条 assistant message：

```ts
assistantMessage.content += event.deltaContent ?? '';
assistantMessage.reasoning_content = `${assistantMessage.reasoning_content ?? ''}${event.deltaReasoningContent ?? ''}`;
```

这意味着一次后端 chunk 可能拆成两次前端 render。

### 当前正文开始判定偏晚

`e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx:43`
当前判断 assistant 是否开始显示正文用的是：

```ts
const hasAssistantContent = message.role === 'assistant' ? message.content.trim().length > 0 : false;
```

如果最先收到的 content delta 是空格、换行或 markdown 前缀空白，思考气泡会继续显示，直到出现第一个非空白字符才隐藏。

## 目标行为

### 场景 1：同一 chunk 同时含 reasoning 与 content
- Main 进程将两者合并成一次 stream event
- Renderer 只执行一次 `setMessages(...)`
- assistant 消息在一次更新内同时获得最新 reasoning/content
- 思考气泡与正文气泡的切换尽量原子化

### 场景 2：正文先收到空白字符
- 即使 content 还是空格或换行
- 也应视为“正文已开始”
- 思考气泡应立即隐藏

### 场景 3：只有 reasoning，没有正文
- 继续显示思考气泡
- 不影响当前独立思考气泡策略

### 场景 4：最终快照覆盖
- `runAgent` 返回最终消息后仍使用最终快照覆盖临时状态
- 但在流式过程中应显著减少闪叠与重绘感

## 技术方案

## 总体方案

本次修复分为两部分：

1. **主进程事件合并**：在 `deepseek-client.ts` 中处理单个 delta 时，先累积 reasoning/content，再统一调用一次 `onChunk(...)`
2. **前端正文开始标记提前**：在 `App.tsx` 的临时 assistant 消息上增加一个前端专用标记字段，用于表示“已经收到过 content delta”，MessageList 优先根据该标记决定是否隐藏思考气泡，而不是依赖 `trim()` 后的正文文本

这样做的原因：
- 单纯把 `trim()` 改成 `content.length > 0` 只能解决空白字符问题，不能解决同一 chunk 被拆成两次更新的问题
- 单纯合并主进程事件可以减少大部分闪叠，但如果 content 最先是空白，仍可能让思考气泡停留偏久
- 两者结合可以更稳定地减少切换抖动

## 详细实现

### 主进程：合并单个 delta 的 stream event

**文件**：`e:\other-code\desktop-tools\src\main\deepseek-client.ts`

当前逻辑会分别触发两次 `onChunk`。改为：

```ts
const nextEvent: ChatCompletionStreamEvent = {};

if (delta.reasoning_content) {
  reasoningContent += delta.reasoning_content;
  nextEvent.deltaReasoningContent = delta.reasoning_content;
}

if (delta.content) {
  content += delta.content;
  nextEvent.deltaContent = delta.content;
}

if (nextEvent.deltaReasoningContent || nextEvent.deltaContent) {
  onChunk(nextEvent);
}
```

效果：
- 同一个 delta 最多只向上游发送一次事件
- 减少 renderer 侧的重复 `setMessages(...)`

### 前端：引入正文开始标记

**文件**：
- `e:\other-code\desktop-tools\src\shared\agent.ts`
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`

#### 扩展前端消息类型
在 `AgentMessage` 中增加前端专用可选字段：

```ts
content_started?: boolean;
```

说明：
- 这是前端展示辅助字段
- 后端快照没有该字段也没关系
- 仅在流式临时消息阶段使用

#### 在流式更新中设置标记
当前 `appendAssistantStreamDelta(...)`：

```ts
assistantMessage.content += event.deltaContent ?? '';
assistantMessage.reasoning_content = `${assistantMessage.reasoning_content ?? ''}${event.deltaReasoningContent ?? ''}`;
```

增加：

```ts
if (event.deltaContent !== undefined) {
  assistantMessage.content_started = true;
}
```

初始化临时 assistant 消息时可设置：

```ts
nextMessages.push({ role: 'assistant', content: '', reasoning_content: '', content_started: false });
```

#### MessageList 使用新标记判断正文是否开始
当前：

```ts
const hasAssistantContent = message.role === 'assistant' ? message.content.trim().length > 0 : false;
```

改为类似：

```ts
const hasAssistantContentStarted =
  message.role === 'assistant' ? (message.content_started === true || message.content.length > 0) : false;
```

然后：

```ts
const showReasoningBubble = message.role === 'assistant' && hasReasoning && !hasAssistantContentStarted;
const showAssistantBubble = message.role !== 'assistant' || hasAssistantContentStarted;
```

这样：
- 只要收到过任何 content delta，就立即切到正文气泡
- 不再依赖 `trim()`

### 最终快照兼容性

最终 `setMessages(response.messages)` 后，后端快照中的 assistant 一般都会有实际正文，因此即便没有 `content_started` 字段，也不会影响历史消息显示。

如果极端情况下后端返回 `content === ''` 但 reasoning 有值，历史消息仍会显示思考气泡。这与当前策略一致，可接受。

## 受影响文件

| 文件 | 修改类型 | 说明 |
|---|---|---|
| `e:\other-code\desktop-tools\src\main\deepseek-client.ts` | 修改 | 合并单个 delta 的 reasoning/content 事件，减少一次 chunk 触发多次更新 |
| `e:\other-code\desktop-tools\src\shared\agent.ts` | 修改 | 为 `AgentMessage` 增加前端展示辅助字段 `content_started?` |
| `e:\other-code\desktop-tools\src\renderer\App.tsx` | 修改 | 在流式 assistant 临时消息中维护 `content_started` 标记 |
| `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx` | 修改 | 使用 `content_started` / `content.length` 判断正文是否开始，提前隐藏思考气泡 |

## 数据流路径

```text
DeepSeek stream chunk
-> deepseek-client 解析单个 delta
-> 同一 delta 中 reasoning/content 合并成一个 AgentStreamEvent
-> Renderer onAgentStream 只触发一次 setMessages
-> appendAssistantStreamDelta 同时追加 reasoning/content，并在收到 content delta 时设置 content_started=true
-> MessageList 根据 content_started 判断隐藏 reasoning 气泡并显示正文气泡
-> runAgent 最终快照覆盖临时状态
```

## 边界条件与异常处理

### 同一 delta 同时含 reasoning + content
- 合并为一次事件
- 避免连续两次 render

### content 为空字符串
- 若 `deltaContent === ''`，可视为未开始，不设置 `content_started`
- 只有实际收到字段时再标记为已开始

### content 仅为空白字符
- `deltaContent` 存在时即设置 `content_started = true`
- reasoning 气泡应立即隐藏

### 只有 reasoning
- `content_started` 保持 false
- reasoning 气泡继续显示

### 最终快照
- 快照中没有 `content_started` 不影响最终显示
- 临时前端字段不会破坏后端消息结构

## 预期结果

- 同一个流式 chunk 不再造成两次前端消息更新
- 思考气泡到正文气泡的切换更平滑，减少闪叠/重影感
- 只要正文开始流入，即使是空白字符，也会立即隐藏思考气泡
- 不影响现有工具调用、最终快照同步与多轮会话 reasoning 保留逻辑
