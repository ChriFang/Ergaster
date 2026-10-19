# 调整控制台操作入口与会话区菜单总结

## 完成结果
本次已按既定任务完成控制台操作入口重构：

- 移除了顶部“更多”按钮及其下拉菜单。
- 移除了顶部“重置会话”按钮。
- 保留左侧边栏“设置与管理”作为唯一设置入口。
- 将“重置会话”迁移到会话区空白处上下文菜单。
- 保留消息内容选中文本的复制菜单，不改变原有复制路径。
- 清理了已无使用的顶部菜单常量、样式和 `use-console-menu` hook。

## 关键实现

### 顶部操作区收缩
- `src/renderer/App.tsx`
  - 移除了 `CONSOLE_MENU_ITEMS` 与 `useConsoleMenu` 的依赖。
  - 删除了顶部 `renderHeaderActions()` 逻辑。
  - `ConsolePanel` 不再接收 `headerActions`。

- `src/renderer/features/layout/ConsolePanel.tsx`
  - 去除 header actions 区块，仅保留当前智能体摘要信息。

### 上下文菜单扩展
- `src/renderer/lib/types/app-shell.ts`
  - 将 `ContextMenuState` 从固定复制菜单模型扩展为区分：
    - `message-selection`
    - `conversation-blank`

- `src/renderer/lib/hooks/use-context-menu.ts`
  - 保留消息选中文本复制逻辑。
  - 新增空白区上下文菜单触发处理。
  - 新增 `handleResetConversation()`，内部复用现有 `handleResetAgent()`，不改变会话作用域与底层 reset 链路。

- `src/renderer/features/context-menu/MessageContextMenu.tsx`
  - 菜单组件改为按上下文场景渲染：
    - 文本选中时显示“复制”
    - 空白区时显示“重置会话”

### 会话区空白处菜单落地
- `src/renderer/features/layout/ConsolePanel.tsx`
  - 在 `console-scroll-area` 上绑定空白区域上下文菜单入口。
  - 继续保留 `MessageList` 的消息右键菜单透传。

- `src/renderer/lib/hooks/use-context-menu.ts`
  - 通过事件目标判断，避免消息项右键与空白区域菜单冲突。

### 清理与样式调整
- `src/renderer/lib/constants/app-constants.ts`
  - 删除不再使用的 `CONSOLE_MENU_ITEMS`。

- `src/renderer/lib/hooks/use-console-menu.ts`
  - 已删除。

- `src/renderer/styles.css`
  - 删除顶部更多菜单相关样式：`console-header-actions`、`dropdown`、`dropdown-menu`、`dropdown-item`、`dropdown-divider` 等无用规则。
  - 保留并复用现有上下文菜单样式用于“复制 / 重置会话”两种菜单场景。

## 行为结果
- 左侧“设置与管理”仍可正常打开设置弹层。
- 顶部不再出现重复设置入口。
- 在消息内容中选中文本后右键，仍可复制选中内容。
- 在会话区空白处触发菜单时，可执行“重置会话”。
- 重置动作继续按当前 `selectedAgentId` 对应会话作用域执行，执行逻辑未改变。

## 验证
已完成以下验证并通过：

- `npm run typecheck`
- `npm run build`

本次调整未引入新的类型错误或构建错误。