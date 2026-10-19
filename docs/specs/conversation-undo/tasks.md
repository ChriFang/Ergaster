# 会话撤销任务计划

- [x] Task 1: 后端截断能力（IPC 四层同步 + 纯函数）
    - 1.1: 新增零依赖纯函数模块 conversation/conversation-truncate.ts：truncateMessagesFromId(messages, messageId) 按 id 定位并截断（保留该消息之前的内容），未命中返回 null
    - 1.2: 新增 conversation-truncate.test.ts 单测（命中截断/未命中/空数组/截断到空/不修改原数组），并登记 package.json test 脚本两处列表
    - 1.3: conversation-service 新增 truncateToMessage(conversationId, messageId)：getAllMessages → 纯函数截断 → setMessages 重写；未命中返回 {ok:false, error}
    - 1.4: conversation-handlers 新增 conversation:truncate handler；contracts/preload/desktop-app-client 四层同步 truncateConversation

- [x] Task 2: 渲染层撤销按钮与交互
    - 2.1: use-chat-session 新增 handleUndoFromMessage(conversationId, messageId)：目标会话桶 isRunning 守卫 → truncateConversation IPC → loadConversationMessages 重载该桶 → refreshConversationList 同步侧边栏
    - 2.2: MessageList 消息卡片 hover 按钮组增加撤销按钮（置于复制按钮之前，Undo2 图标）；显示条件 message.id 存在且非 tool 折叠条；isRunning 时禁用；新 prop onUndoFromMessage
    - 2.3: ConsolePanel / ChatConsoleView 透传 onUndoFromMessage；App.tsx window.confirm 确认（提示不可恢复）后调用

- [x] Task 3: 验证与回归
    - 3.1: npm run typecheck 通过
    - 3.2: npm test 通过（含 truncate 纯函数单测）
    - 3.3: 手工验证：撤销按钮位置与显隐、确认弹窗、截断后 UI/侧边栏条数同步、运行中禁用、撤销到开头显示欢迎语、多会话下各会话独立生效
