# App.tsx 拆分与 renderer lib 结构重构总结

## 完成情况
已按设计完成 `App.tsx` 拆分与 `src/renderer/lib` 结构引入，保留了现有 Agent 执行、流式消息、工具确认、配置保存、输入历史与智能体会话隔离逻辑。

## 主要改动
- 将 renderer 本地类型迁移到 `src/renderer/lib/types/app-shell.ts`
- 将默认欢迎消息与控制台菜单配置迁移到 `src/renderer/lib/constants/app-constants.ts`
- 将会话 scope 与流式消息纯函数迁移到：
  - `src/renderer/lib/utils/conversation.ts`
  - `src/renderer/lib/utils/agent-stream.ts`
- 新增 `src/renderer/lib/desktop/desktop-app-client.ts`，集中封装 `window.desktopApp` 的 renderer 侧访问入口
- 新增并接入以下 hooks：
  - `src/renderer/lib/hooks/use-settings-state.ts`
  - `src/renderer/lib/hooks/use-chat-session.ts`
  - `src/renderer/lib/hooks/use-composer-state.ts`
  - `src/renderer/lib/hooks/use-context-menu.ts`
  - `src/renderer/lib/hooks/use-console-menu.ts`
  - `src/renderer/lib/hooks/use-app-bootstrap.ts`
- 将 `src/renderer/features/layout/SettingsDialogShell.tsx`、`src/renderer/features/layout/ConsolePanel.tsx` 的局部类型改为复用 `lib/types`
- 重写 `src/renderer/App.tsx`，将其收敛为页面编排器，主要负责：
  - 顶层 hooks 装配
  - `SidebarPanel` / `ConsolePanel` / `SettingsDialogShell` 组装
  - About 面板渲染
  - 少量跨模块协调逻辑

## 结果
- `App.tsx` 从 600+ 行缩减为以装配逻辑为主的顶层组件
- renderer 逻辑按“types / constants / utils / desktop / hooks”分层，后续演进路径更清晰
- 未引入新的状态管理库或运行时依赖
- 保持了既有 IPC 语义与执行行为

## 验证
已执行并通过：
- `npm run typecheck`
- `npm run build`
