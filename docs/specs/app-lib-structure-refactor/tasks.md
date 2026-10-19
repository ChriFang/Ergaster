# App.tsx 拆分与 renderer lib 结构重构任务计划
- [x] Task 1: 提取 renderer 本地类型、常量与纯工具函数
    - 1.1: 新建 `lib/types/app-shell.ts`，迁移 `ContextMenuState`、`SettingsDialogTab` 等 App 本地类型
    - 1.2: 新建 `lib/constants/app-constants.ts`，提取默认欢迎消息与可复用静态配置
    - 1.3: 新建 `lib/utils/conversation.ts`，迁移会话 scope 相关纯函数
    - 1.4: 新建 `lib/utils/agent-stream.ts`，迁移流式消息匹配、拼接与最新流式消息推导逻辑
    - 1.5: 调整 `App.tsx` 与相关组件的导入，确保类型与纯函数引用正常

- [x] Task 2: 建立 renderer 侧 desktop client 与基础状态 hooks
    - 2.1: 新建 `lib/desktop/desktop-app-client.ts`，集中封装 `window.desktopApp` 的直通调用与事件订阅入口
    - 2.2: 新建 `lib/hooks/use-console-menu.ts`，迁移菜单开关、菜单 ref 与点击外部关闭逻辑
    - 2.3: 新建 `lib/hooks/use-context-menu.ts`，迁移消息右键菜单状态、复制逻辑与关闭副作用
    - 2.4: 新建 `lib/hooks/use-composer-state.ts`，迁移输入框、输入历史、草稿选择与 Enter 提交判定逻辑
    - 2.5: 让 `App.tsx` 改为依赖 desktop client 与基础 hooks，消除重复的全局对象访问

- [x] Task 3: 提取会话运行与配置管理 hooks
    - 3.1: 新建 `lib/hooks/use-settings-state.ts`，迁移配置加载回写、tool settings 文本映射、保存与思考模式切换逻辑
    - 3.2: 新建 `lib/hooks/use-chat-session.ts`，迁移消息状态、Agent 执行、工具确认、会话重置、agent 切换与工具消息展开逻辑
    - 3.3: 新建 `lib/hooks/use-app-bootstrap.ts`，迁移首屏加载与 stream / tool confirmation 订阅逻辑
    - 3.4: 保持运行状态、错误恢复、会话隔离、输入历史更新与流式消息拼接语义不变

- [x] Task 4: 收敛 App.tsx 为页面编排器并验证行为
    - 4.1: 重写 `App.tsx` 组装顶层 hooks、菜单、主布局与设置对话框内容渲染
    - 4.2: 仅在必要范围内调整 `SettingsDialogShell.tsx`、`ConsolePanel.tsx` 等组件的类型引用
    - 4.3: 执行 `npm run typecheck`，修复拆分引入的类型或导入问题
    - 4.4: 执行 `npm run build`，确认 renderer / main / preload 构建通过
    - 4.5: 回写任务完成状态并整理 `.comate/specs/app-lib-structure-refactor/summary.md`
