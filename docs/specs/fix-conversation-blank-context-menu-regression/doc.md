# 修复会话区空白处右键菜单在对话后失效的问题

## 背景与目标
前一次 UI 调整已将“重置会话”从顶部按钮迁移到会话区空白处上下文菜单。当前发现一个回归问题：

- 初始状态下，右键会话区空白处可以正常弹出“重置会话”菜单。
- 进行一轮对话、消息渲染出来后，再右键会话区看起来为空白的位置，无法再弹出“重置会话”菜单。

本次修复目标是在不改变现有消息复制菜单逻辑、不改变会话重置逻辑和作用域的前提下，修复“有消息后空白区右键菜单失效”的判定问题。

## 场景与处理逻辑

### 场景一：初始无消息状态
- 用户在会话区空白处触发上下文菜单。
- 继续正常显示“重置会话”。
- 该行为当前已正常，不应被破坏。

### 场景二：已有消息后，在消息气泡外的空白区域右键
- 用户完成一轮对话后，在消息行左右留白、消息列表下方留白或滚动区可见空白区域触发上下文菜单。
- 应继续显示“重置会话”。
- 这是本次需要恢复的核心路径。

### 场景三：用户在消息内容上右键且存在选中文本
- 继续优先显示“复制”菜单。
- 不应误弹“重置会话”。

### 场景四：用户在消息卡片主体上右键但没有文本选中
- 应视为消息区交互范围，而不是空白区。
- 不弹空白区“重置会话”菜单。
- 保持当前“消息区与空白区区分”的产品语义。

## 根因分析
当前 `use-context-menu.ts` 中的空白区判定逻辑如下：

```ts
if (target.closest('.message-row') || target.closest('.message-card-shell') || target.closest('.message-context-menu')) {
  return;
}
```

问题在于：
- `.message-row` 是一整行布局容器，而不是仅包裹消息气泡的精确命中区域。
- 当消息渲染出来后，`.message-row` 会覆盖整条消息横向区域。
- 因此用户右键很多视觉上属于“留白”的位置时，`target.closest('.message-row')` 仍会命中，导致逻辑提前 `return`。
- 初始状态没有 `.message-row`，所以空白菜单可以正常弹出；一旦有消息，这个过宽判定就会吞掉大量空白区域右键事件。

## 架构与技术方案

### 1. 收窄空白区过滤条件
最小修复方案是在 `src/renderer/lib/hooks/use-context-menu.ts` 中收窄过滤逻辑：

- 移除 `.message-row` 这一层的过滤。
- 继续保留 `.message-card-shell` 过滤，用于识别真正的消息卡片主体。
- 继续保留 `.message-context-menu` 过滤，避免菜单自身交互触发重复处理。

目标逻辑应类似：

```ts
if (target.closest('.message-card-shell') || target.closest('.message-context-menu')) {
  return;
}
```

这样可以实现：
- 点在消息卡片主体上：仍不弹空白菜单。
- 点在消息行左右空白带、消息列表底部空白处：允许弹空白菜单。

### 2. 保持消息复制菜单优先级不变
`handleMessageContextMenu()` 仍然只在存在文本选中时工作，并通过 `event.stopPropagation()` 阻断空白区菜单接管。这一优先级关系不需要改变。

### 3. 保持会话重置调用链不变
本次只修正前端事件判定，不修改以下逻辑：
- `handleResetConversation()`
- `handleResetAgent()`
- `desktopAppClient.resetAgent(...)`
- preload / main / agent-service 的 reset 调用链

## 涉及文件与修改范围

### 需要修改的现有文件
1. `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-context-menu.ts`
   - 收窄空白区判定条件
   - 去掉 `.message-row` 的过滤
   - 保留消息卡片与菜单自身过滤

### 需要验证但不一定修改的文件
2. `e:\other-code\desktop-tools\src\renderer\features\layout\ConsolePanel.tsx`
   - 确认 `console-scroll-area` 的 `onContextMenu` 绑定继续生效

3. `e:\other-code\desktop-tools\src\renderer\features\context-menu\MessageContextMenu.tsx`
   - 确认“复制 / 重置会话”菜单渲染逻辑不需要联动修改

4. `e:\other-code\desktop-tools\src\renderer\styles.css`
   - 确认 `.message-row` 与 `.message-card-shell` 的布局关系，验证无需额外样式修复

## 数据流与调用链
- 用户在会话区可见空白位置右键
- `ConsolePanel` 的 `console-scroll-area` 捕获 `onContextMenu`
- `useContextMenu().handleConversationBlankContextMenu()` 检查事件 target
- 若未命中真正消息卡片主体，则设置 `conversation-blank` 菜单状态
- 菜单组件显示“重置会话”
- 点击后沿用现有 reset 链路执行

## 边界条件与异常处理
- 若当前存在文本选中，继续不显示空白区菜单，避免与复制冲突。
- 若点击消息卡片主体，不应显示空白区菜单。
- 若点击消息行左右留白、消息列表底部留白，应允许显示空白区菜单。
- 菜单在点击其他位置、按 `Escape`、滚动时继续自动关闭。

## 预期结果
修复完成后应满足：
- 初始化状态下空白区右键菜单仍正常。
- 完成一轮或多轮对话后，消息行周围留白与会话区底部空白处右键仍可弹出“重置会话”。
- 消息选中文本复制菜单保持正常。
- 不引入新的消息区/空白区判定错误。

## 验证要求
- TypeScript 类型检查通过。
- 构建通过。
- 手工交互验证以下路径：
  - 初始空白区右键可弹出“重置会话”
  - 发送一轮对话后，在消息气泡左右空白区域右键可弹出“重置会话”
  - 在消息列表底部空白区域右键可弹出“重置会话”
  - 在消息内容中选中文本右键仍显示“复制”
