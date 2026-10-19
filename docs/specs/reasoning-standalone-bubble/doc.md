# 独立思考气泡显示改造设计

## 需求背景

当前 assistant 的 `reasoning_content` 仍然依附在 assistant 正文消息内部展示。即使已经去掉收起态预览，只要 reasoning 与正文在流式阶段发生时间重叠，仍然可能造成视觉上的重复感。

新的需求是：
- 将思考过程改为独立气泡显示
- 在开始显示正文 `content` 之前，可以显示思考过程气泡
- 一旦开始显示正文，就隐藏思考过程气泡
- 正文继续以 assistant 气泡独立显示

该需求的核心不是改变会话消息存储结构，而是改变渲染策略：对同一条 assistant 消息在 UI 上按阶段派生为不同气泡。

## 现状分析

### 当前流式状态模型

`e:\other-code\desktop-tools\src\renderer\App.tsx:34`
当前前端流式更新逻辑会把 `deltaReasoningContent` 与 `deltaContent` 累加到同一条 assistant 消息：

```ts
assistantMessage.content += event.deltaContent ?? '';
assistantMessage.reasoning_content = `${assistantMessage.reasoning_content ?? ''}${event.deltaReasoningContent ?? ''}`;
```

这意味着：
- 状态层只有一条 assistant 消息
- `reasoning_content` 与 `content` 都挂在同一个 `AgentMessage`
- 最终 `runAgent` 返回的消息快照也沿用这一结构

### 当前消息渲染结构

`e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx:35`
当前 `MessageList` 假设：
- `messages.map(...)` 中一条 `AgentMessage` 渲染成一个 `<article>` 气泡
- assistant 的 reasoning 作为正文气泡内部子块渲染

因此目前并没有真正的 reasoning 独立气泡概念。

### 现有数据结构适配性

`e:\other-code\desktop-tools\src\shared\agent.ts:11`
`AgentMessage` 已包含：
- `content`
- `reasoning_content`

因此从数据上无需新增消息类型，也无需改主进程协议。更合适的方案是在渲染层“虚拟派生”一个 reasoning 气泡。

## 目标行为

### 场景 1：只有 reasoning，正文尚未开始
- assistant 当前消息 `reasoning_content` 有值
- assistant 当前消息 `content` 为空
- 在消息列表中显示一个独立的“思考过程”气泡
- 不显示 assistant 正文气泡内容

### 场景 2：正文开始流式输出
- 一旦 assistant 当前消息 `content` 非空
- 立即隐藏 reasoning 独立气泡
- 只显示 assistant 正文气泡

### 场景 3：最终结果返回
- 最终 `setMessages(response.messages)` 仍使用后端快照
- reasoning 数据继续保留在消息对象中，用于多轮会话回传
- 但 UI 层不再在正文出现后展示 reasoning 气泡

### 场景 4：非流式历史消息
- 对已经完成的历史 assistant 消息，如果 `content` 非空，则默认不展示 reasoning 独立气泡
- 这样可避免历史消息再次出现“思考过程”视觉噪音

## 技术方案

## 总体方案

采用“渲染层虚拟气泡”方案，不改 `App.tsx` 中的消息存储模型，不在状态层真的拆成两条消息。

具体做法：
1. 保持 `AgentMessage` 结构不变
2. 保持 `appendAssistantStreamDelta(...)` 累加逻辑不变
3. 在 `MessageList.tsx` 中针对 assistant 消息派生渲染：
   - 若 `reasoning_content` 非空且 `content` 为空，则先渲染一个 reasoning 独立气泡
   - assistant 正文气泡仍按原逻辑渲染，但正文为空时不渲染正文内容块
   - 一旦 `content` 非空，不再渲染 reasoning 独立气泡
4. 删除 reasoning 折叠状态与按钮逻辑，因为需求已改为“独立气泡 + 正文出现后隐藏”，不再需要手动展开/收起

该方案的优点：
- 不改主进程与协议
- 不改 `runAgent` 最终快照结构
- 不在前端状态里混入临时伪消息
- 改动集中在渲染层，风险最小

## 详细实现

### MessageList 渲染策略调整

**文件**：`e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`

#### 新增派生判断
对于 assistant 消息增加：

```ts
const reasoningText = getAssistantReasoningText(message);
const hasReasoning = reasoningText.length > 0;
const hasAssistantContent = message.content.trim().length > 0;
const showReasoningBubble = message.role === 'assistant' && hasReasoning && !hasAssistantContent;
```

#### 渲染 reasoning 独立气泡
在 assistant 正文气泡前插入一个独立 `<article>`：

```tsx
{showReasoningBubble ? (
  <article key={`${messageKey}-reasoning`} className="message message-assistant-reasoning">
    <div className="message-header">
      <div className="message-role">思考过程</div>
    </div>
    <MessageContent body={{ kind: 'markdown', text: reasoningText }} onContextMenu={onMessageContextMenu} />
  </article>
) : null}
```

#### assistant 正文气泡显示规则
原本 assistant 消息始终渲染正文 `<article>`。现在需要调整为：
- 如果 `message.role !== 'assistant'`，保持现状
- 如果 `message.role === 'assistant'` 且 `content` 非空，正常渲染 assistant 气泡
- 如果 `message.role === 'assistant'` 且 `content` 为空，则不渲染正文内容块，避免出现空白正文气泡

更稳妥的实现是先把每条消息映射为一个 `ReactNode[]`，而不是强行在一个 `return` 里塞两个 article。

### App 状态简化

**文件**：`e:\other-code\desktop-tools\src\renderer\App.tsx`

当前仍保留：
- `expandedReasoningMessageKeys`
- `handleToggleReasoningMessage(...)`
- 传递给 `MessageList` 的 reasoning 折叠 props

由于新需求不再需要用户手动展开/收起 reasoning，这些状态可以删除：

```ts
const [expandedReasoningMessageKeys, setExpandedReasoningMessageKeys] = useState<Record<string, boolean>>({});
```

以及：

```ts
function handleToggleReasoningMessage(messageKey: string) { ... }
```

并同步删除传给 `MessageList` 的：
- `expandedReasoningMessageKeys`
- `onToggleReasoningMessage`

### message-model 辅助逻辑调整

**文件**：`e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts`

目前 `hasAssistantReasoning(...)` 仍然可复用。

可增加一个更明确的辅助函数：

```ts
export function hasAssistantContent(message: AgentMessage) {
  return message.role === 'assistant' ? message.content.trim().length > 0 : Boolean(message.content.trim());
}
```

但这不是必须；也可以直接在 `MessageList.tsx` 内局部判断，保持改动最小。

### 样式改造

**文件**：`e:\other-code\desktop-tools\src\renderer\styles.css`

当前 reasoning 样式是内嵌块：
- `.message-reasoning-block`
- `.message-reasoning-toggle`
- `.message-reasoning-content`

这些将不再需要。

新增独立气泡样式，例如：

```css
.message-assistant-reasoning {
  background: rgba(15, 23, 42, 0.62);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.message-assistant-reasoning .message-role {
  color: #cbd5e1;
}
```

视觉目标：
- 让 reasoning 气泡看起来是 assistant 的临时思考阶段
- 但与正式回答气泡有一定区分

### 复制与右键行为

复制与右键选择不需要额外协议变更。

对于 reasoning 独立气泡：
- 可保留复制按钮，复制 reasoning 文本
- 或者不显示复制按钮，仅保留正文气泡的复制按钮

本次建议：**reasoning 气泡不放复制按钮**，避免在正文尚未出现时顶部出现多个操作按钮；用户仍可通过右键选择复制。

## 受影响文件

| 文件 | 修改类型 | 说明 |
|---|---|---|
| `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx` | 修改 | 将 assistant reasoning 从内嵌块改为独立气泡派生渲染，并在正文出现后隐藏 |
| `e:\other-code\desktop-tools\src\renderer\App.tsx` | 修改 | 删除 reasoning 折叠状态与传参 |
| `e:\other-code\desktop-tools\src\renderer\styles.css` | 修改 | 删除/替换旧 reasoning 内嵌块样式，新增独立 reasoning 气泡样式 |
| `e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts` | 可能修改 | 保留或轻量补充 assistant content/reasoning 判断辅助函数 |

## 数据流路径

```text
DeepSeek deltaReasoningContent
-> App.tsx 累加到 assistant.reasoning_content
-> MessageList 判断 content 是否为空
-> 若 content 为空，则渲染 reasoning 独立气泡
-> 一旦 deltaContent 到来使 content 非空
-> MessageList 停止渲染 reasoning 气泡，开始渲染 assistant 正文气泡
-> 最终快照覆盖后，history assistant 因 content 非空默认不展示 reasoning 气泡
```

## 边界条件与异常处理

### reasoning 先出现，正文很晚才出现
- reasoning 独立气泡持续更新
- 正文开始后 reasoning 气泡立即消失

### reasoning 与正文同时开始
- 若当前 render 周期中 `content` 已非空，则直接不显示 reasoning 气泡
- 只显示正文气泡

### 只有 reasoning，没有正文
- 在异常情况下可持续显示 reasoning 独立气泡
- 不额外渲染空正文气泡

### 历史消息
- 因为历史 assistant 通常 `content` 已非空
- 默认不显示 reasoning 气泡
- reasoning 仅保留在数据中用于下一轮请求

### 工具消息
- 完全不受影响

## 预期结果

- 流式阶段的思考过程改为独立气泡显示
- 一旦开始输出正文，思考过程气泡自动隐藏
- 不再出现 reasoning 与正文在同一视觉区域或相邻区域重叠导致的重复感
- 不影响现有流式正文展示、最终会话快照同步与多轮请求 reasoning 保留能力
