# Agent 状态 UI 调整任务计划

- [x] Task 1: 重构 ActivityPanel 组件 - 新的属性接口与动态动画
    - 1.1: 修改 ActivityPanel props 接口，将 `confirmationRequest` 替换为 `isRunning` 和 `errorMessage`
    - 1.2: 实现"运行中"状态的展示，包含状态标签（蓝色"执行中"徽章）和说明文字
    - 1.3: 实现动态加载动画 `./../...`，使用 `useEffect` + `setInterval` 每 500ms 循环切换
    - 1.4: 实现"错误"状态的展示，包含红色错误徽章和 `errorMessage` 文字
    - 1.5: 调整 ActivityPanel 样式为对话卡片风格（参考 `.message` 样式）

- [x] Task 2: 更新 App.tsx - 状态管理与渲染逻辑
    - 2.1: 移除侧边栏中的"Agent 状态"卡片（第 293-298 行）
    - 2.2: 新增 `lastError` 状态变量（`string | null`）
    - 2.3: 在 `handleRunAgent` 开头清除 `lastError`，在 catch 块中设置 `lastError = error.message`
    - 2.4: 在 `handleResetAgent` 中清除 `lastError`
    - 2.5: 修改 ActivityPanel 渲染条件为 `((isRunning || lastError) && !confirmationRequest)`
    - 2.6: 将 ActivityPanel 从消息列表上方移到消息列表下方（`MessageList` 之后）
    - 2.7: 更新 ActivityPanel 调用，传入新的 `isRunning` 和 `errorMessage` props
    - 2.8: 移除 `onToolConfirmationRequested` 回调中的 `setRunStatus` 调用（状态文字不再需要）

- [x] Task 3: 更新 styles.css - 对话卡片样式
    - 3.1: 修改 `.activity-panel` 样式，采用类似 `.message` 的对话卡片风格（圆角、边框、半透明背景）
    - 3.2: 新增运行中状态的动画相关 CSS（如 `activity-dot-animation` 类）
    - 3.3: 确保 ActivityPanel 在消息列表中视觉协调，不再使用原有的 flex row 全宽布局
