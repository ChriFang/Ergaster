# 隐藏会话气泡中的角色名称并保留必要识别信息总结

## 已完成内容
- 在 `src/renderer/features/messages/MessageList.tsx` 中收窄了普通消息头部的渲染条件，用户和助手气泡不再显示“用户”“助手”等角色名称。
- 保留了工具消息的必要头部信息，仅工具消息继续显示 `message-role`、`tool: {name}`、执行状态和展开/收起按钮。
- 推理消息“思考过程”标题与 `ActivityPanel` 中的“系统”标题保持不变，没有扩散修改范围。
- 普通消息在不再需要头部信息时会直接省略对应 header 容器，避免留下多余留白，同时不影响复制按钮与正文布局。

## 影响文件
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`
- `e:\other-code\desktop-tools\.comate\specs\hide-chat-role-labels-in-bubbles\tasks.md`
- `e:\other-code\desktop-tools\.comate\specs\hide-chat-role-labels-in-bubbles\summary.md`

## 验证结果
- `npm run typecheck`：通过
- `npm run build`：通过

## 结果说明
- 普通用户/助手消息现在仅通过头像、左右位置和现有气泡样式区分角色，更接近 `agent-ui` 的图标化消息风格。
- 工具消息、推理消息和系统活动面板仍保留必要的语义标识，没有损失可读性。
- 本轮修改未影响右键菜单、活动面板宽度、水滴状气泡和工具消息交互链路。