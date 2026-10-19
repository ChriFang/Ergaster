# Agent 状态 UI 调整

## 需求概述

将 Agent 执行状态从侧边栏移动到对话面板中，优化状态显示逻辑，增加动态动画效果，并改进错误状态的持久化显示。

## 需求分解

### 需求 1：将 Agent 执行状态移到对话面板中

**场景**：当前 Agent 状态显示在左侧侧边栏的"Agent 状态"卡片中（`App.tsx:293-298`），用户需要将其移到右侧对话面板（chat-panel）中显示。

**处理逻辑**：
- 移除侧边栏中的"Agent 状态"卡片（`App.tsx:293-298`）
- 增强现有的 `ActivityPanel` 组件，使其成为对话面板中主要的 Agent 状态展示区域
- **状态卡片样式**：采用与对话消息（`.message`）相同的卡片样式（圆角边框、半透明背景等），使其在视觉上与对话消息融为一体
- **位置**：状态卡片放在对话消息列表的最下方（`MessageList` 之后），作为对话面板的最后一条"消息"，而非当前位于消息列表上方的独立 banner

**影响文件**：
- `src/renderer/App.tsx`（修改）：移除 sidebar 中的 Agent 状态卡片，调整 ActivityPanel 的渲染位置
- `src/renderer/features/activity/ActivityPanel.tsx`（修改）：增强状态展示能力，调整样式为对话卡片风格
- `src/renderer/styles.css`（修改）：新增/调整 ActivityPanel 的对话卡片样式

---

### 需求 2：状态显示/隐藏逻辑与动态动画

**场景**：
- 用户输入请求后，对话面板中显示 Agent 执行状态
- 模型正常回复后，隐藏状态界面
- 执行过程中，状态文字增加动态显示效果（`./../...` 循环交替）

**处理逻辑**：

#### 显示/隐藏规则：
| 条件 | ActivityPanel 显示? | 说明 |
|------|---------------------|------|
| 用户刚提交请求 | 显示 | isRunning = true |
| 正在等待模型/工具执行 | 显示 | isRunning = true，显示动画 |
| 外部工具确认弹窗出现 | 隐藏 | confirmationRequest != null |
| 模型正常完成回复 | 隐藏 | isRunning = false, lastError = null |
| 执行出错 | 显示 | lastError != null，即使 isRunning = false |

#### 动态动画实现：
- 在 `ActivityPanel` 中使用 `useEffect` + `setInterval`，每 500ms 循环切换显示文字
- 动画序列：`"."` → `".."` → `"..."` → `"."` ...
- 当 `isRunning` 为 false 时清除 interval

**影响文件**：
- `src/renderer/App.tsx`（修改）：调整 ActivityPanel 的渲染条件，新增 `lastError` 状态
- `src/renderer/features/activity/ActivityPanel.tsx`（修改）：增加动画逻辑和新 props

---

### 需求 3：工具确认时隐藏状态、确认后恢复

**场景**：当系统弹出外部工具调用确认面板时（`ConfirmationPanel`），隐藏 Agent 状态显示；用户确认或拒绝后，重新显示状态界面。

**处理逻辑**：
- `App.tsx` 中 ActivityPanel 的渲染条件增加：`!confirmationRequest`
- 用户确认/拒绝工具调用后，`confirmationRequest` 被清空，ActivityPanel 自动恢复显示

**当前流程**：
```
用户提交请求 → isRunning=true, ActivityPanel显示
  → 工具需确认 → confirmationRequest设置, ActivityPanel隐藏, ConfirmationPanel显示
  → 用户确认/拒绝 → confirmationRequest清空, ActivityPanel重新显示
  → 模型回复完成 → isRunning=false, ActivityPanel隐藏
```

**影响文件**：
- `src/renderer/App.tsx`（修改）：调整 ActivityPanel 的渲染条件

---

### 需求 4：出错时保持状态显示直到下次对话

**场景**：Agent 执行出错时，保持错误状态显示在对话面板中不隐藏。直到用户发起下一次对话时，才清除错误状态，显示新的运行状态。

**处理逻辑**：
- 新增 `lastError` 状态变量（`string | null`），存储上一次执行出错时的错误消息
- 在 `handleRunAgent` 的 catch 块中，设置 `lastError = error.message`
- 在 `handleRunAgent` 开始时（try 之前），清除 `lastError = null`
- ActivityPanel 渲染条件：`(isRunning && !confirmationRequest) || (lastError !== null && !confirmationRequest)`
- ActivityPanel 根据 `isRunning` 和 `lastError` 区别显示：
  - `lastError` 不为空时：显示红色错误状态
  - `isRunning` 为 true 时：显示蓝色运行中状态（带动画）

**影响文件**：
- `src/renderer/App.tsx`（修改）：新增 `lastError` 状态，修改 try/catch 逻辑，调整渲染条件
- `src/renderer/features/activity/ActivityPanel.tsx`（修改）：支持错误状态展示

---

## 架构与技术方案

### 状态变更汇总

`App.tsx` 中状态变化：

| 状态变量 | 类型 | 变更 |
|----------|------|------|
| `runStatus` | `string` | 保留，但仅在 sidebar 移除后作为内部状态使用（或直接移除） |
| `isRunning` | `boolean` | 不变 |
| `confirmationRequest` | `ToolConfirmationRequest \| null` | 不变 |
| `lastError` | `string \| null` | **新增**，持久化错误消息 |

### ActivityPanel 组件接口变更

```typescript
// 旧接口
type ActivityPanelProps = {
  confirmationRequest: ToolConfirmationRequest | null;
};

// 新接口
type ActivityPanelProps = {
  isRunning: boolean;
  errorMessage: string | null;
};
```

原 `confirmationRequest` prop 不再需要，因为隐藏逻辑已移至父组件。

### 数据流路径

```
用户提交请求
  → handleRunAgent() 调用
  → setInput(''), setIsRunning(true), setLastError(null), setConfirmationRequest(null)
  → setRunStatus('Agent 正在执行...')
  → ActivityPanel 显示（isRunning=true, 带动画）
  
  → [分支1: 正常完成]
    → setMessages(response.messages), setRunStatus(...)
    → finally: setIsRunning(false)
    → ActivityPanel 隐藏

  → [分支2: 工具确认]
    → onToolConfirmationRequested 回调
    → setConfirmationRequest(request)
    → ActivityPanel 隐藏（父组件条件判断）
    → ConfirmationPanel 显示
    → 用户响应后: setConfirmationRequest(null)
    → ActivityPanel 重新显示

  → [分支3: 执行出错]
    → catch: setLastError(error.message)
    → finally: setIsRunning(false)
    → ActivityPanel 保持显示（lastError不为空）, 显示错误信息

下次对话
  → handleRunAgent() 调用
  → setLastError(null) 清除旧错误
  → 开始新的正常流程
```

### 侧边栏调整

移除第三个 status-card（Agent 状态），保留"应用状态"和"DeepSeek 配置"两个卡片。若需要给用户提供简洁的状态感知，可以在保留的两个卡片中体现。

---

## 边界条件与异常处理

1. **已有请求正在执行时再次提交**：`agent-service.ts` 会抛出 "已有请求正在执行..." 错误，此错误应被 `lastError` 状态捕获并持久显示
2. **取消操作**：`handleCancelAgent` 设置 `isRunning=false`，`lastError` 未被设置，ActivityPanel 应隐藏
3. **重置会话**：`handleResetAgent` 应同时清除 `lastError`
4. **工具确认超时**：自动拒绝后 `confirmationRequest` 清空，ActivityPanel 恢复显示
5. **快速连续操作**：`lastError` 在每次 `handleRunAgent` 开头被清除，确保新对话不会显示旧错误

---

## 预期效果

- 侧边栏更简洁，Agent 状态信息移到对话面板中
- 执行中可见动态加载动画（`./../...`），用户体验更直观
- 工具确认时不干扰用户决策，确认后无缝恢复状态显示
- 错误信息持久显示直到用户发起新对话，方便排查问题