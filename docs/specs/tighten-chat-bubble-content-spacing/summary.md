# 收紧会话气泡内文字上下留白以提升信息密度总结

## 已完成内容
- 在 `src/renderer/styles.css` 中将 `.message-card-shell` 的上下内边距从 `12px` 收紧到 `10px`，统一压缩普通消息、推理消息和工具消息的气泡内留白。
- 将 `.message-content` 的默认顶部间距从 `10px` 调整为 `8px`，保留有 header 消息的基础层级感。
- 新增 `.message-content-no-header`，并在 `MessageList.tsx` / `MessageContent.tsx` 中仅对无 header 的普通消息正文应用该类，使用户/助手消息正文不再额外吃到顶部空白。
- 同时将 `.message-summary` 的顶部间距收紧到 `8px`，避免工具消息展开态的 `header -> summary -> content` 纵向节奏过松。

## 影响文件
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageContent.tsx`
- `e:\other-code\desktop-tools\src\renderer\styles.css`
- `e:\other-code\desktop-tools\.comate\specs\tighten-chat-bubble-content-spacing\tasks.md`
- `e:\other-code\desktop-tools\.comate\specs\tighten-chat-bubble-content-spacing\summary.md`

## 验证结果
- `npm run typecheck`：通过
- `npm run build`：通过

## 结果说明
- 普通用户/助手消息的正文现在更贴近气泡顶部和底部，同屏能显示更多内容。
- 推理消息和工具消息也同步变得更紧凑，但仍保留 header-content 的必要层级。
- 本轮修改未影响水滴状气泡、角色名称隐藏、活动面板宽度和右键菜单等已完成迁移结果。