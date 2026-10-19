# Agent 状态 UI 调整 - 实施总结

## 修改概览

本次修改将 Agent 执行状态从左侧侧边栏移至对话面板，采用对话卡片样式，增加动态加载动画，并优化了工具确认和错误状态的处理逻辑。

## 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/renderer/features/activity/ActivityPanel.tsx` | 重写 | 新的 props 接口（`isRunning` + `errorMessage`），动态 dots 动画，运行/错误双状态展示，对话卡片结构 |
| `src/renderer/App.tsx` | 修改 | 移除侧边栏状态卡片，新增 `lastError` 状态，调整渲染条件与位置，更新回调逻辑 |
| `src/renderer/styles.css` | 修改 | 重构 ActivityPanel 样式为对话卡片风格，新增 `.activity-panel-running` 和 `.activity-panel-error` 变体 |

---

## 详细变更

### 1. ActivityPanel.tsx（重写）

**Props 接口变更**：
- 旧：`{ confirmationRequest: ToolConfirmationRequest | null }`
- 新：`{ isRunning: boolean; errorMessage: string | null }`

**动态动画**：
- 使用 `useEffect` + `setInterval` 每 500ms 循环切换 `DOTS_SEQUENCE = ['.', '..', '...']`
- 当 `isRunning` 变为 false 时自动清除 interval 并重置 dotIndex

**双状态展示**：
- **运行中**：蓝色"执行中." 徽章 + "正在处理当前请求，请稍候." 文字（带 dot 动画）
- **错误**：红色"执行失败"徽章 + `errorMessage` 错误详情

**卡片结构**：使用 `.message-header` + `.message-status` + `.message-content` 与对话消息统一的结构

### 2. App.tsx（多处修改）

**状态管理**：
- 新增 `lastError` 状态（第 36 行），类型 `string | null`
- 在 `handleRunAgent` 开头清除 `lastError`（第 225 行）
- 在 `catch` 块中设置 `lastError = message`（第 235 行）
- 在 `handleResetAgent` 中清除 `lastError`（第 266 行）

**渲染逻辑**：
- 移除了侧边栏中"Agent 状态"的 status-card
- ActivityPanel 从消息列表上方移至下方（第 377-379 行），退出动画发生在消息内容渲染后
- 渲染条件改为 `((isRunning || lastError) && !confirmationRequest)`：
  - 运行中且无确认弹窗：显示运行状态
  - 出错且无确认弹窗：显示错误状态
  - 有确认弹窗：隐藏

**回调简化**：
- `onToolConfirmationRequested` 回调中移除了 `setRunStatus` 调用（不再需要在侧边栏显示确认文字）

### 3. styles.css（样式重构）

**移除旧样式**：
- `.activity-panel` 从 `.settings-panel, .confirm-panel, .activity-panel` 共享组中分离
- 移除了 `flex-direction: row` 的全宽 banner 布局

**新增样式**：
- `.activity-panel`：对话卡片风格（`max-width: 760px`，`border-radius: 18px`，与 `.message` 一致）
- `.activity-panel-running`：蓝色边框（`rgba(96, 165, 250, 0.2)`）
- `.activity-panel-error`：红色边框（`rgba(248, 113, 113, 0.35)`）
- `.activity-panel .message-content p` 和 `.activity-panel .message-header` 的微调

---

## 行为验证矩阵

| 场景 | 预期行为 | 实现位置 |
|------|----------|----------|
| 用户提交请求 | ActivityPanel 显示，蓝色运行中状态 + 动态 dots | `App.tsx:377` + `ActivityPanel.tsx` |
| 模型正常回复 | ActivityPanel 隐藏 | `App.tsx:377`（isRunning=false, lastError=null） |
| 工具调用确认弹窗 | ActivityPanel 隐藏 | `App.tsx:377`（confirmationRequest != null） |
| 用户确认/拒绝后 | ActivityPanel 恢复显示 | `App.tsx:377`（confirmationRequest 清空） |
| 执行出错 | ActivityPanel 保持显示，红色错误状态 | `App.tsx:377`（lastError != null）+ `ActivityPanel.tsx` |
| 下次对话 | 错误清除，显示新的运行状态 | `App.tsx:225`（setLastError(null)） |
| 重置会话 | ActivityPanel 隐藏（lastError 清空） | `App.tsx:266` |
| 取消执行 | ActivityPanel 隐藏 | `App.tsx:254-258`（isRunning=false, lastError 未设置） |