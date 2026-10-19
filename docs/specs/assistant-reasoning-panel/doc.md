# Assistant 气泡思维链展示改造设计

## 需求背景

当前项目已经完成 DeepSeek 流式响应接入，`reasoning_content` 会在主进程与渲染层之间传递，并在前端消息状态中持续累加，但界面中 assistant 气泡只展示最终回答正文，没有展示思维链。

本次需求是在 assistant 气泡上方增加“思考过程”折叠区，并满足以下行为：
- assistant 气泡正文区域继续展示最终回答 `content`
- 若存在 `reasoning_content`，则在正文上方展示“思考过程”折叠区
- 流式返回过程中，`reasoning_content` 需要实时更新到该折叠区
- 最终回答仍显示在正文区，不与思维链混排

## 现状分析

### 现有数据链路

- `e:\other-code\desktop-tools\src\shared\agent.ts:11`：`AgentMessage` 已包含 `reasoning_content?: string`
- `e:\other-code\desktop-tools\src\shared\agent.ts:19`：`AgentStreamEvent` 已包含 `deltaReasoningContent?: string`
- `e:\other-code\desktop-tools\src\renderer\App.tsx:34`：流式处理中已经把 `deltaReasoningContent` 累加到 assistant 消息的 `reasoning_content`
- `e:\other-code\desktop-tools\src\main\agent-service.ts:20`：主进程回传给前端的 assistant 消息已经包含 `reasoning_content`

说明：数据侧已经具备，不需要再改 DeepSeek API 或主进程流式协议。

### 当前未展示的原因

- `e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts:44` 中 assistant 消息正文模型只返回 `message.content`
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx:30` 仅渲染消息头、工具状态与正文 `MessageContent`
- 当前没有任何“assistant reasoning 面板”的折叠状态或 UI 结构
- 样式集中在 `e:\other-code\desktop-tools\src\renderer\styles.css`

## 目标行为

### 场景 1：普通 assistant 消息
- 如果消息没有 `reasoning_content`
- assistant 气泡保持现状，仅展示正文
- 不出现“思考过程”区域

### 场景 2：有思维链的 assistant 消息
- 在 assistant 气泡头部下方、正文上方展示折叠区
- 默认显示一条可点击的标题栏，如“思考过程”
- 用户可以展开/收起思维链内容
- 正文 `content` 始终独立展示在下方

### 场景 3：流式生成中
- 如果流中持续收到 `deltaReasoningContent`
- 已展开的思考过程区域需要实时追加新内容
- 如果用户尚未展开，标题区仍应可见，并显示当前已存在思维链
- `deltaContent` 继续更新正文区，不改变两者的展示分区

### 场景 4：最终结果落盘后
- `runAgent` 返回最终消息快照时，界面仍以最终 messages 覆盖临时状态
- 折叠区应继续读取最终消息中的 `reasoning_content`
- 不应因为最终快照覆盖导致思维链丢失

## 技术方案

## 总体方案

本次改造以前端为主，不改动现有流式协议与主进程逻辑。采用如下方案：

1. 保持 `App.tsx` 中的流式 `reasoning_content` 累加逻辑
2. 在消息列表层为 assistant 消息新增 reasoning 折叠区渲染
3. 在渲染层维护 assistant reasoning 展开状态
4. 使用现有 `MessageContent` 组件渲染 reasoning markdown，避免新增重复渲染逻辑

这样可以最小化修改范围，并复用现有 markdown 展示、右键复制、自动滚动能力。

## 详细实现

### 折叠状态设计

**文件**：`e:\other-code\desktop-tools\src\renderer\App.tsx`

当前已有工具消息折叠状态：
- `expandedToolMessageKeys`

本次增加 assistant reasoning 折叠状态，例如：

```ts
const [expandedReasoningMessageKeys, setExpandedReasoningMessageKeys] = useState<Record<string, boolean>>({});
```

并提供切换函数：

```ts
function handleToggleReasoningMessage(messageKey: string) {
  setExpandedReasoningMessageKeys((current) => ({
    ...current,
    [messageKey]: !current[messageKey],
  }));
}
```

说明：
- 以 `messageKey` 为粒度维护展开状态
- 不依赖消息索引之外的新 id 结构，保持与现有工具折叠区一致
- 当消息列表被最终快照覆盖时，只要 `messageKey` 计算方式不变，展开状态可自然延续

### assistant reasoning 视图模型

**文件**：`e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts`

新增 reasoning 相关辅助逻辑，例如：

```ts
export function getAssistantReasoningText(message: AgentMessage) {
  return message.role === 'assistant' ? (message.reasoning_content?.trim() ?? '') : '';
}

export function hasAssistantReasoning(message: AgentMessage) {
  return getAssistantReasoningText(message).length > 0;
}
```

可选增加 reasoning 预览逻辑：

```ts
export function getReasoningPreviewText(text: string) {
  const normalized = text.replace(/\r\n/g, '\n');
  const firstLine = normalized.split('\n')[0]?.trim();
  return firstLine || '思考过程中...';
}
```

说明：
- assistant 正文模型 `getMessageBodyModel(...)` 继续只负责正文 `content`
- reasoning 由单独辅助函数处理，避免把思维链与正文混在一个 `MessageBodyModel` 中

### MessageList 渲染结构改造

**文件**：`e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`

#### 新增 props

在 `MessageListProps` 中增加：

```ts
expandedReasoningMessageKeys: Record<string, boolean>;
onToggleReasoningMessage: (messageKey: string) => void;
```

#### 为 assistant 消息增加 reasoning 面板

在遍历消息时，判断：

```ts
const reasoningText = hasAssistantReasoning(message) ? getAssistantReasoningText(message) : '';
const hasReasoning = reasoningText.length > 0;
const isReasoningExpanded = hasReasoning ? Boolean(expandedReasoningMessageKeys[messageKey]) : false;
const reasoningPreview = hasReasoning ? getReasoningPreviewText(reasoningText) : '';
```

然后在 assistant 正文上方插入 reasoning 区域，结构建议如下：

```tsx
{message.role === 'assistant' && hasReasoning ? (
  <div className="message-reasoning-block">
    <button
      className="message-reasoning-toggle"
      type="button"
      aria-expanded={isReasoningExpanded}
      onClick={() => onToggleReasoningMessage(messageKey)}
    >
      {isReasoningExpanded ? '收起思考过程' : '展开思考过程'}
    </button>
    {isReasoningExpanded ? (
      <MessageContent body={{ kind: 'markdown', text: reasoningText }} onContextMenu={onMessageContextMenu} />
    ) : (
      <div className="message-content message-content-collapsed" onContextMenu={onMessageContextMenu}>
        {reasoningPreview}
      </div>
    )}
  </div>
) : null}
```

#### 复制行为

当前复制文本：
- 工具消息复制解析后的工具文本
- 非工具消息复制正文 `body.text`

本次建议 assistant 复制行为保持现状：
- 默认点击“复制”仍复制最终回答正文 `content`
- 不额外拼接 reasoning_content

原因：
- 用户对“复制消息”通常预期是复制最终答复
- 若需要复制思维链，可后续单独给 reasoning 区增加复制按钮
- 本次需求没有要求改变复制语义

### MessageContent 复用策略

**文件**：`e:\other-code\desktop-tools\src\renderer\features\messages\MessageContent.tsx`

本次不强制修改 `MessageContent.tsx` 逻辑。

原因：
- 它已经支持 markdown/plain 两种展示
- reasoning_content 可以直接构造为 `MessageBodyModel` 传入复用
- 链接打开与右键菜单行为能自动继承

仅当后续希望对 reasoning 区使用特殊 markdown 样式时，才需要进一步分支化该组件。

### App 组件接线改造

**文件**：`e:\other-code\desktop-tools\src\renderer\App.tsx`

#### 新增状态
增加 `expandedReasoningMessageKeys`

#### 向 MessageList 传参
在现有：
`e:\other-code\desktop-tools\src\renderer\App.tsx:499`

补充：

```tsx
<MessageList
  messages={visibleMessages}
  expandedToolMessageKeys={expandedToolMessageKeys}
  expandedReasoningMessageKeys={expandedReasoningMessageKeys}
  onToggleToolMessage={handleToggleToolMessage}
  onToggleReasoningMessage={handleToggleReasoningMessage}
  ...
/>
```

#### 流式逻辑
`appendAssistantStreamDelta(...)` 当前已正确累加 `reasoning_content`：
- `e:\other-code\desktop-tools\src\renderer\App.tsx:34`

因此这里仅需保留，不再额外改流逻辑。

## 样式方案

**文件**：`e:\other-code\desktop-tools\src\renderer\styles.css`

在现有 `.message*` 样式基础上新增 reasoning 区块样式，例如：

```css
.message-reasoning-block {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.42);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.message-reasoning-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: #cbd5e1;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}

.message-reasoning-label {
  font-weight: 600;
}

.message-reasoning-content .message-content {
  margin-top: 10px;
}
```

样式目标：
- reasoning 区与正文在视觉上有层次区分
- 不抢占 assistant 正文主视觉
- 与当前深色主题一致

## 受影响文件

| 文件 | 修改类型 | 说明 |
|---|---|---|
| `e:\other-code\desktop-tools\src\renderer\App.tsx` | 修改 | 增加 assistant reasoning 折叠状态并向 MessageList 传参 |
| `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx` | 修改 | 在 assistant 气泡中渲染“思考过程”折叠区 |
| `e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts` | 修改 | 增加 reasoning 文本判断、预览等辅助函数 |
| `e:\other-code\desktop-tools\src\renderer\styles.css` | 修改 | 增加 reasoning 区块与折叠按钮样式 |
| `e:\other-code\desktop-tools\src\renderer\features\messages\MessageContent.tsx` | 可选 | 若需要对 reasoning 区单独样式封装，可做轻量调整 |

## 数据流路径

```text
DeepSeek 流式 chunk
-> Main 进程发出 deltaReasoningContent / deltaContent
-> Renderer App.onAgentStream 收到事件
-> appendAssistantStreamDelta 累加到 assistant.reasoning_content / assistant.content
-> MessageList 读取当前消息
-> 若 assistant 含 reasoning_content，则渲染“思考过程”折叠区
-> reasoning 区实时刷新，正文区继续显示最终回答内容
-> runAgent 返回最终消息快照后覆盖临时态，reasoning 与正文一起保留
```

## 边界条件与异常处理

### 无 reasoning_content
- 不展示折叠区
- assistant 气泡保持原状

### 只有 reasoning 尚无正文
- 折叠区可先展示思维链
- 正文区为空时仍保留 assistant 消息容器
- 待 `content` 流入后再自然补齐正文

### reasoning 很长
- 收起状态只显示首行预览
- 展开后显示完整 markdown 内容
- 依赖现有滚动容器，不单独引入局部滚动区

### 流式更新中用户切换展开状态
- 展开/收起仅影响显示，不影响内容累加
- 若已展开，新增 reasoning delta 应实时出现在展开内容中

### 最终快照覆盖
- 最终 `setMessages(response.messages)` 后应继续展示 reasoning
- reasoning 折叠状态按 messageKey 保持，如果 messageKey 变化则退回默认收起

### 复制语义
- assistant 主复制按钮仍复制正文，不复制 reasoning
- 避免改变已有用户习惯

## 预期结果

- assistant 气泡上方出现“思考过程”折叠区
- reasoning_content 在流式生成过程中可以实时刷新显示
- 最终回答继续独立展示在正文区
- 无 reasoning 的消息不受影响
- 不破坏现有流式回复、工具消息折叠、右键复制与自动滚动能力
