# 去掉会话区顶部标题右侧 agent 字段

## 需求场景与处理逻辑
用户希望移除会话区顶部标题右侧显示的 `agent xxx` 字段，但在动手修改前先定位相应代码。基于当前代码分析，普通聊天会话区的顶部标题由 `ChatConsoleView` 渲染；当存在 `selectedAgent` 时，头部依次展示 agent 首字母徽标、标题与状态、描述，以及右侧的 `console-agent-meta` 元信息块。该元信息块目前固定展示标签 `agent` 和 `selectedAgent.id`，正是目标字段来源。

本次变更仅移除顶部标题右侧的 `agent xxx` 展示，不调整 agent 选择逻辑、消息会话逻辑、左侧边栏展示，也不改变 workflow 视图。

## 架构与技术方案
采用最小改动方案：
1. 在 `ChatConsoleView` 中删除 `selectedAgent` 分支下的 `console-agent-meta` JSX 节点。
2. 清理 `styles.css` 中仅供该节点使用的 `.console-agent-meta` 样式。
3. 保持 `selectedAgent` 数据链路不变，因为标题、徽标、状态与后续会话执行仍依赖该对象。

这样可以确保 UI 行为只发生定点变化，不影响 agent 会话切换、消息加载和执行请求。

## 影响文件
- 修改 `e:\other-code\desktop-tools\src\renderer\features\layout\ChatConsoleView.tsx`
  - 类型：删除现有 JSX 片段
  - 影响函数：`ChatConsoleView`
  - 影响位置：`selectedAgent` 分支头部渲染区域
- 修改 `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 类型：删除无用样式
  - 影响样式：`.console-agent-meta`

## 实现细节
当前命中代码位于 `src/renderer/features/layout/ChatConsoleView.tsx:94`：

```tsx
<div className="console-agent-meta">
  <span>agent</span>
  <span>{selectedAgent.id}</span>
</div>
```

计划改为直接删除该块，保留前面的标题摘要结构：

```tsx
<>
  <div className="console-agent-badge">...</div>
  <div className="console-agent-summary">...</div>
</>
```

同时删除 `src/renderer/styles.css:398` 左右的 `.console-agent-meta` 样式定义，避免遗留未使用样式：

```css
.console-agent-meta {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
  padding: 6px 0 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-soft);
  font-size: 11px;
  word-break: break-all;
}
```

## 边界条件与异常处理
- 当 `selectedAgent` 为 `null` 时，当前显示的是“默认模式”头部，不存在 `agent xxx` 字段，本次无需调整。
- 当进入 workflow 视图时，头部由 `WorkflowConsoleView` 渲染，不属于本次修改范围。
- 删除右侧元信息后，header 布局将由现有 flex 自动收缩；若视觉上出现空白过大，再根据结果决定是否补充样式微调，但默认不引入额外改动。

## 数据流路径
1. 主进程 `AgentProfilesService.getAgentListItems()` 产出 agent 列表项。
2. 前端 `useChatSession` 维护 `agents` 与 `selectedAgentId`，并推导 `selectedAgent`。
3. `App` 将 `selectedAgent` 传给 `ConsolePanel`。
4. `ConsolePanel` 在聊天模式下将 `selectedAgent` 传给 `ChatConsoleView`。
5. `ChatConsoleView` 当前使用 `selectedAgent.title` 渲染标题，并使用 `selectedAgent.id` 渲染右侧 `agent xxx`。

本次只修改第 5 步中的展示层，不改动上游数据生产和传递。

## 预期结果
- 聊天会话区顶部不再显示右侧 `agent xxx` 字段。
- agent 标题、在线状态、描述、消息区与输入区保持原有行为。
- 不影响左侧 agent 列表中的 `ID: {agent.id}` 展示。
- 不影响 workflow 相关 header。

## 已确认的定位结论
- 最直接的目标代码：`e:\other-code\desktop-tools\src\renderer\features\layout\ChatConsoleView.tsx:94`
- 对应样式：`e:\other-code\desktop-tools\src\renderer\styles.css:398`
- 上游数据来源：`e:\other-code\desktop-tools\src\renderer\lib\hooks\use-chat-session.ts:130`
