# 左侧边栏输入记录扁平化与元信息展示总结

## 完成内容

- 已将输入历史数据结构扩展为包含 `createdAt` 时间戳。
- 已兼容旧历史数据格式：
  - 字符串数组历史会迁移为 `{ text, agentId: null, createdAt }`。
  - 缺少 `createdAt` 的对象历史会自动补齐时间。
- 已将左侧边栏“输入记录”从按智能体分组改为扁平列表。
- 已按 `agent-ui` 参考样式展示每条记录：
  - 第一行展示输入内容。
  - 第二行展示 `智能体 · 时间`。
- 已保留点击历史记录恢复输入草稿的原有行为。
- 已删除侧边栏输入记录分组渲染逻辑和不再使用的分组样式。

## 修改文件

- `e:\other-code\desktop-tools\src\shared\contracts.ts`
  - `InputHistoryEntry` 新增 `createdAt: number`。

- `e:\other-code\desktop-tools\src\main\input-history-service.ts`
  - 历史读取归一化逻辑补齐 `createdAt`。
  - 新增历史记录时写入当前时间。
  - 保持原有 `text + agentId` 去重规则。

- `e:\other-code\desktop-tools\src\main\index.ts`
  - IPC 追加历史记录时补齐 `createdAt` 参数。

- `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-chat-session.ts`
  - 前端乐观更新历史记录时写入 `createdAt`。

- `e:\other-code\desktop-tools\src\renderer\features\layout\SidebarPanel.tsx`
  - 移除 `groupHistoryByAgent` 和 `HistoryGroup`。
  - 新增智能体名称解析与相对时间格式化。
  - 输入记录页签直接遍历 `inputHistory` 渲染扁平列表。

- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 调整 `.app-history-item` 为两行卡片布局。
  - 新增 `.app-history-item-text`、`.app-history-item-meta`、`.app-history-item-agent`。
  - 移除不再使用的 `.app-history-group*` 分组样式。

## 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过。

## 结果

左侧边栏“输入记录”现在以扁平列表展示，不再按智能体统一归类。每条记录包含输入内容、智能体名称和相对时间，并继续支持点击恢复历史输入。
