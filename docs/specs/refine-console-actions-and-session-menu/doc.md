# 调整控制台操作入口与会话区上下文菜单

## 背景与目标
当前渲染层已经完成一次较大规模的 UI 重构，左侧边栏底部已经提供“设置与管理”入口，但顶部会话区仍保留“更多”按钮用于打开设置类菜单，同时还在顶部显式提供“重置会话”按钮。这造成两个问题：

1. 设置入口重复，顶部“更多”与左侧边栏入口在信息架构上重叠。
2. “重置会话”属于低频且具破坏性的操作，不适合继续占用顶部主操作位。

本次调整目标是在不改变现有执行逻辑、会话作用域与 IPC 行为的前提下，完成以下 UI 入口重构：

- 去掉顶部“更多”按钮及其下拉菜单。
- 保留左侧边栏“设置与管理”作为唯一设置入口。
- 去掉顶部“重置会话”按钮。
- 在会话区空白区域提供上下文菜单，并将“重置会话”迁移到该菜单中。
- 保留消息内容已有的选中文本复制菜单，避免影响复制行为。

## 场景与处理逻辑

### 场景一：用户打开设置
- 用户从左侧边栏底部点击“设置与管理”。
- 应继续打开现有设置弹层，不改变 tab 切换逻辑。
- 顶部不再提供“更多”按钮，也不再承载 settings/agents/skills/mcp/about 等入口。

### 场景二：用户在消息内容中选择文本并右键
- 若消息内容中存在有效选中文本，继续弹出当前消息上下文菜单。
- 菜单继续提供“复制”能力。
- 不在该场景混入“重置会话”，避免消息菜单和会话菜单语义混杂。

### 场景三：用户在会话区空白处触发上下文菜单
- 当用户在会话滚动区域的空白位置触发上下文菜单时，弹出新的区域级菜单。
- 菜单提供“重置会话”。
- 点击后调用现有 `handleResetAgent()`，保持按当前 `selectedAgentId` 对应作用域重置，不改变底层业务语义。
- 执行后关闭菜单，并沿用现有状态提示“会话已重置。”。

### 场景四：用户在非空白区触发事件
- 消息卡片、消息文本、工具消息等已有交互区域应继续维持既有行为。
- 空白区上下文菜单只在明确的空白容器上触发，避免覆盖消息区右键逻辑。

## 架构与技术方案

### 1. 收缩 `App.tsx` 顶部操作装配
当前 `src/renderer/App.tsx` 通过 `renderHeaderActions()` 同时渲染“重置会话”和“更多”菜单，并依赖 `useConsoleMenu()` 与 `CONSOLE_MENU_ITEMS`。本次将：

- 移除 `useConsoleMenu()` 的使用。
- 移除 `renderHeaderActions()` 中的“更多”按钮与下拉菜单。
- 移除 `renderHeaderActions()` 中的“重置会话”按钮。
- 将 `ConsolePanel` 的 header actions 简化为空或直接取消该 prop。
- 继续保留 `handleResetAgent()`，但改为传递给会话区上下文菜单触发逻辑。

### 2. 扩展会话区上下文菜单状态模型
当前 `useContextMenu()` 仅维护：

```ts
{
  x: number;
  y: number;
  selectedText: string;
}
```

该状态只能表达“选中文本复制菜单”。本次应扩展为可区分菜单场景，例如：

```ts
{
  x: number;
  y: number;
  type: 'message-selection' | 'conversation-blank';
  selectedText?: string;
}
```

这样可以在同一套关闭逻辑与定位逻辑下，同时支持：
- 消息选中文本复制菜单
- 会话空白处重置菜单

### 3. 扩展 `useContextMenu()` 的触发入口
现有 hook 仅暴露 `handleMessageContextMenu()`，并且只有在存在选中文本时才显示菜单。本次应在该 hook 中新增空白区域触发处理函数，例如：

- `handleConversationBlankContextMenu(event)`

处理要求：
- 仅在空白区容器触发时调用。
- 阻止默认右键菜单。
- 若当前存在文本选中，应优先清理浏览器选区或直接不进入空白菜单，避免与消息复制菜单冲突。
- 设置 `type: 'conversation-blank'` 的菜单状态。

### 4. 扩展菜单组件为场景化渲染
当前 `MessageContextMenu.tsx` 只有一个固定按钮“复制”。本次建议保持文件最小修改，但将其升级为通用上下文菜单组件，按 state 类型决定渲染内容：

- `message-selection` -> 显示“复制”
- `conversation-blank` -> 显示“重置会话”

如果现有命名不再准确，可在最小改动前提下继续沿用组件文件名，避免不必要的重命名带来的扩散修改。

### 5. 在 `ConsolePanel` 绑定空白区菜单入口
当前 `ConsolePanel` 中的 `console-scroll-area` 与 `console-message-stack` 并未绑定空白区上下文菜单。应在承载消息列表的滚动区或消息堆栈容器上新增空白区域上下文菜单处理。

推荐策略：
- 在 `console-scroll-area` 或 `console-message-stack` 上绑定区域级 `onContextMenu`。
- 通过事件目标判断是否来自空白容器本身；若事件来自消息子节点，则让消息区自己的 `onMessageContextMenu` 逻辑优先处理。
- 仅在空白区域调用 `handleConversationBlankContextMenu()`。

### 6. 清理不再使用的顶部菜单实现
若顶部“更多”彻底删除，以下内容将失去用途：
- `useConsoleMenu()` hook
- `CONSOLE_MENU_ITEMS` 常量（如果没有其他使用方）

本次应在实现中一并清理未使用代码，保持拆分后的 renderer 结构整洁。

## 涉及文件与修改范围

### 需要修改的现有文件
1. `e:\other-code\desktop-tools\src\renderer\App.tsx`
   - 移除顶部“更多”与“重置会话”按钮装配
   - 移除 `useConsoleMenu()` 相关依赖
   - 将会话重置能力传给 `ConsolePanel`

2. `e:\other-code\desktop-tools\src\renderer\features\layout\ConsolePanel.tsx`
   - 调整 header actions 渲染
   - 新增会话区空白处上下文菜单入口
   - 透传空白菜单与复制菜单所需事件/回调

3. `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-context-menu.ts`
   - 扩展上下文菜单状态模型
   - 增加空白区域菜单触发能力
   - 继续保留复制逻辑
   - 新增重置菜单关闭/触发逻辑封装

4. `e:\other-code\desktop-tools\src\renderer\features\context-menu\MessageContextMenu.tsx`
   - 改为根据菜单状态渲染“复制”或“重置会话”操作

5. `e:\other-code\desktop-tools\src\renderer\lib\types\app-shell.ts`
   - 更新 `ContextMenuState` 类型定义，支持菜单场景区分

6. `e:\other-code\desktop-tools\src\renderer\styles.css`
   - 删除顶部更多菜单相关样式（若已无使用）
   - 如有必要微调上下文菜单项样式，确保新增“重置会话”项视觉一致

### 可能需要清理的文件
7. `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-console-menu.ts`
   - 若已无引用，则删除

8. `e:\other-code\desktop-tools\src\renderer\lib\constants\app-constants.ts`
   - 若 `CONSOLE_MENU_ITEMS` 已无使用，则删除该常量并保留其他仍在使用的常量

## 数据流与调用链
- 用户在空白区触发菜单
- `ConsolePanel` 捕获空白区上下文菜单事件
- `useContextMenu()` 设置 `conversation-blank` 菜单状态
- 菜单组件渲染“重置会话”
- 点击后调用 `handleResetAgent()`
- `handleResetAgent()` 调用 `desktopAppClient.resetAgent(toConversationScope(selectedAgentId))`
- preload/main/agent-service 继续沿用现有 IPC 与会话重置逻辑
- 前端消息状态清空并更新 `runStatus`

## 边界条件与异常处理
- 若用户在消息内容中有文本选区，继续走复制菜单，不显示空白区菜单。
- 若用户在空白区触发菜单但当前没有实际会话消息，也允许显示“重置会话”；行为保持幂等，由现有 reset 逻辑处理。
- 菜单在以下情况仍应自动关闭：
  - 点击其他区域
  - 按下 `Escape`
  - 会话滚动区域滚动
- 不引入新的确认弹窗，保持当前重置交互的直接性。
- 不调整左侧设置入口的文案、位置与打开 tab 行为，除非实现时发现必须联动。

## 实施细节建议

### `App.tsx`
- 删除：
  - `useConsoleMenu` import
  - `CONSOLE_MENU_ITEMS` import
  - `renderHeaderActions()`
- 调整 `useContextMenu(...)` 的调用，传入会话重置回调或从返回值中获取空白区菜单处理能力。
- 调整 `ConsolePanel` props，使其接收新的上下文菜单处理函数，而不是顶部 header actions。

### `use-context-menu.ts`
建议最终返回接口类似：

```ts
return {
  contextMenuState,
  copyText,
  handleCopySelection,
  handleMessageContextMenu,
  handleConversationBlankContextMenu,
  handleResetConversation,
};
```

其中 `handleResetConversation` 内部负责：
- 调用外部传入的 `onResetConversation`
- 菜单关闭
- 复用现有错误/状态更新来源，不额外复制业务逻辑

### `ConsolePanel.tsx`
建议把滚动区结构调整为：
- 消息项继续通过 `MessageList` 绑定消息右键
- 滚动区容器绑定空白处右键
- 菜单组件统一挂在滚动区内，继续用绝对定位显示

## 预期结果
完成后，界面与行为应满足：
- 顶部不再出现“更多”按钮
- 顶部不再出现“重置会话”按钮
- 左侧设置入口仍可正常打开设置弹层
- 在消息文本选中后右键，仍可复制
- 在会话区空白处触发菜单时，可看到“重置会话”
- 点击“重置会话”后，仍按当前 agent 会话作用域正确重置
- 不引入新的闪烁、重复渲染或状态错乱问题

## 验证要求
- TypeScript 类型检查通过
- Vite/Electron renderer 构建通过
- 手工交互验证以下路径：
  - 左侧设置入口正常打开
  - 消息选中文本复制菜单正常
  - 空白区上下文菜单正常
  - 重置会话后消息区与状态提示正确
