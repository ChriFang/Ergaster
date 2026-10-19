# 收起态隐藏思维链预览修复设计

## 需求背景

当前 assistant 气泡已经支持展示“思考过程”折叠区，但在收起状态下仍会显示 reasoning 的首行预览。由于 DeepSeek 流式返回中，`reasoning_content` 与 `content` 可能在某些时刻内容相同或高度相似，导致用户看到收起态预览与正文同时出现，表现为流式内容像被打印了两次，例如“？”显示成“？？”。

本次修复采用第 3 种方案：
- 保留“思考过程”折叠入口
- 收起时不再展示 reasoning 首行预览
- 仅在用户展开后显示完整 reasoning 内容
- 正文区继续独立展示 `content`

## 现状分析

### 当前渲染行为

`e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx:87`
当前 assistant reasoning 区逻辑为：
- 有 `reasoning_content` 时始终渲染 reasoning block
- 展开时用 `MessageContent` 渲染完整 reasoning
- 收起时渲染 `reasoningPreviewText`

当前收起分支：

```tsx
<div className="message-content message-content-collapsed" onContextMenu={onMessageContextMenu}>
  {reasoningPreviewText}
</div>
```

这会导致：
- 收起态也会直接占据一行可见文本
- 当正文与 reasoning 内容相同或相近时，视觉上像重复输出

### 当前辅助模型

`e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts:52`
目前仍保留：

```ts
export function getReasoningPreviewText(text: string)
```

如果改为“收起不显示预览”，该辅助函数将不再需要。

### 当前样式

`e:\other-code\desktop-tools\src\renderer\styles.css:739`
目前 `.message-reasoning-content .message-content` 用于展开区顶部间距；收起态使用通用 `.message-content-collapsed` 样式承载预览文本。

## 目标行为

### 场景 1：assistant 无 reasoning
- 与现状一致
- 不显示“思考过程”区域

### 场景 2：assistant 有 reasoning 且处于收起态
- 显示“思考过程 / 展开”按钮
- 不显示任何 reasoning 预览文本
- 页面只看到正文，不再产生“重复打印”视觉效果

### 场景 3：assistant 有 reasoning 且处于展开态
- 显示“思考过程 / 收起”按钮
- 展开后显示完整 reasoning markdown
- 正文仍在下方独立显示

### 场景 4：流式更新中
- reasoning_content 仍持续累加到消息状态
- 收起时不展示这些增量内容
- 用户点击展开后可看到当前累计到的完整 reasoning
- 正文 `content` 继续实时显示

## 技术方案

## 总体方案

本次只改前端展示层，不调整主进程流式协议，也不改变 reasoning 数据结构。核心思路：

1. 保留 assistant reasoning block 和展开/收起按钮
2. 删除收起态的 reasoning 预览内容节点
3. 仅在 `isReasoningExpanded === true` 时渲染 reasoning 内容容器
4. 清理不再使用的 preview 计算逻辑与相关 import

这是最小改动方案，直接针对“看起来重复显示”的来源，不影响：
- 流式正文更新
- reasoning 数据保留
- 思考过程可展开查看

## 详细实现

### MessageList 渲染调整

**文件**：`e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`

当前代码：

```tsx
<div className="message-reasoning-content">
  {isReasoningExpanded ? (
    <MessageContent body={{ kind: 'markdown', text: reasoningText }} onContextMenu={onMessageContextMenu} />
  ) : (
    <div className="message-content message-content-collapsed" onContextMenu={onMessageContextMenu}>
      {reasoningPreviewText}
    </div>
  )}
</div>
```

改为：

```tsx
{isReasoningExpanded ? (
  <div className="message-reasoning-content">
    <MessageContent body={{ kind: 'markdown', text: reasoningText }} onContextMenu={onMessageContextMenu} />
  </div>
) : null}
```

效果：
- 收起时只保留按钮，不渲染任何文本预览
- 展开时才显示 reasoning 内容

### 清理 preview 依赖

**文件**：`e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts`

删除不再使用的：

```ts
export function getReasoningPreviewText(text: string)
```

同时更新 `MessageList.tsx` import，移除：
- `getReasoningPreviewText`

### 样式微调

**文件**：`e:\other-code\desktop-tools\src\renderer\styles.css`

现有样式大部分可复用，仅需确认：
- `.message-reasoning-block` 在没有预览文本时视觉上仍合理
- `.message-reasoning-content .message-content` 仅在展开态生效

如需要，可增加按钮与区块之间的间距控制，例如：

```css
.message-reasoning-content {
  margin-top: 10px;
}

.message-reasoning-content .message-content {
  margin-top: 0;
}
```

这样能避免因为原有 `.message-content` 默认 `margin-top: 12px` 导致展开态上下间距偏大。

## 受影响文件

| 文件 | 修改类型 | 说明 |
|---|---|---|
| `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx` | 修改 | 去掉 reasoning 收起态预览，仅保留展开态内容渲染 |
| `e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts` | 修改 | 删除不再需要的 `getReasoningPreviewText` |
| `e:\other-code\desktop-tools\src\renderer\styles.css` | 可能修改 | 视展开态间距表现补充轻量样式 |

## 数据流路径

```text
DeepSeek 流式 deltaReasoningContent
-> App.tsx 继续累加到 assistant.reasoning_content
-> MessageList 读取 hasReasoning / isReasoningExpanded
-> 收起时仅显示“思考过程”按钮，不显示 preview
-> 展开后才渲染 reasoning markdown
-> 正文区持续独立显示 content
```

## 边界条件与异常处理

### 收起态下流式更新
- reasoning 持续累加但不显示
- 不影响正文实时流式展示

### 用户中途展开
- 直接展示当前已累计的全部 reasoning
- 不需要额外同步逻辑

### 最终快照覆盖
- 最终 `setMessages(response.messages)` 后 reasoning 仍保留
- 若消息 key 不变，展开状态继续保持

### 无 reasoning
- assistant 气泡完全不受影响

### 复制语义
- assistant 主复制按钮仍只复制正文
- reasoning 未新增额外复制按钮

## 预期结果

- assistant 气泡收起态不再显示思维链首行预览
- 流式短文本不再因为 reasoning 预览与正文并存而看起来重复打印
- 用户仍可通过“展开”查看完整思考过程
- 不影响现有流式正文展示、thinking 数据保留与最终消息同步
