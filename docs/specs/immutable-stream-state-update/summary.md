# 以不可变状态更新修复流式文本重复追加总结

## 完成情况
已完成 `tasks.md` 中全部 3 项任务。本次修复目标是消除 renderer 在流式累积 assistant 文本时对旧 state 对象的原地修改，避免在 `React.StrictMode` 开发模式下同一增量被重复拼接，进而导致 `MessageList` 中出现 `学习学习`、`Rust Rust` 这类内容级重复。

## 实际改动

### 1. 将流式消息累积改为不可变更新
文件：`e:\other-code\desktop-tools\src\renderer\App.tsx`
- 重写 `appendAssistantStreamDelta(...)`
- 不再先浅拷贝数组后直接修改 `assistantMessage.content` / `reasoning_content` / `content_started`
- 改为：
  - 未命中目标消息时，直接返回追加了新 assistant 消息的新数组
  - 命中目标消息时，基于旧对象创建 `updatedAssistantMessage`
  - 用新对象替换数组中对应位置，再返回新数组

### 2. 保留既有流式行为
文件：`e:\other-code\desktop-tools\src\renderer\App.tsx`
- 继续保留 `streamMessageId` 作为流式消息定位依据
- 继续保留 `content_started` 用于 reasoning -> 正文的即时切换
- 新建 assistant 临时消息时，首个 delta 会直接初始化 `content` / `reasoning_content`，避免先创建空对象再 mutation

### 3. 保留 `React.StrictMode`，通过纯状态更新修复问题
文件：`e:\other-code\desktop-tools\src\renderer\main.tsx`
- 未移除 `React.StrictMode`
- 修复方式是让 state updater 保持纯函数，而不是通过关闭严格模式掩盖问题

## 额外修正
在首次实现不可变更新后，`npm run typecheck` 报出新建 assistant 消息对象的 `role` 被推断为 `string`，不满足 `AgentMessage` 的字面量联合类型要求。

已在 `src/renderer/App.tsx` 中将其修正为：
```ts
role: 'assistant' as const
```

## 验证结果
已完成：
- `npm run typecheck`
- `npm run build`

结果：全部通过。

## 预期收益
- `MessageList` 中的 `body.text` 不再因为 state mutation 出现 `学习学习`、`Rust Rust` 这类重复内容
- 在保留 `React.StrictMode` 的前提下，同一流式增量不会被错误地再次拼接到同一条 assistant 消息
- 不影响现有 `streamMessageId` 身份稳定化修复
- 不影响现有 reasoning bubble 与正文切换逻辑
