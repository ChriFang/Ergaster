# 多会话独立视图任务计划

- [✓] Task 1: 抽出按会话分桶的 session store（等价重构，行为不变）
    - 1.1: 新增 session-store 模块，定义 SessionState 类型与纯函数 reducer（创建桶、更新桶字段、读取桶、初始空桶）
    - 1.2: use-chat-session 内部改为持有 Map<conversationId, SessionState>（useReducer/version 触发渲染），保留现有对外返回字段名不变
    - 1.3: 从"活动桶"派生 messages/isRunning/runStatus/lastError/confirmationRequest/filePreviews/expandedToolMessageKeys/cursor 等对外切片
    - 1.4: 迁移 handleRunAgent/handleSelectConversation/switchConversationScope/loadConversationMessages 等改为读写"指定 conversationId 的桶"，此阶段仍维持"切换即重载、非活动事件丢弃"的旧行为，确保等价
    - 1.5: 新增 session-store 纯函数单测（建桶/更新/读取切片）

- [✓] Task 2: 流事件从"丢弃"改为"路由到对应桶"
    - 2.1: applyStreamDelta 反转逻辑，按 event.conversationId 写入对应桶，非活动会话照常累积
    - 2.2: 流缓冲（pendingStreamEvents + flush timer）改为按会话隔离，避免前后台 delta 混流
    - 2.3: use-app-bootstrap 的流事件监听改为直接交路由，去掉"绕过 agent 过滤"的临时分支
    - 2.4: 补充路由与缓冲隔离的单测（多会话事件不串桶、done 冲刷仅作用对应桶）

- [✓] Task 3: 切换即时化与运行态语义调整
    - 3.1: handleSelectConversation 命中桶直接切 activeConversationId（无重载），未命中才建桶 + loadConversationMessages
    - 3.2: isRunning 改为每会话语义；派生全局 hasAnyRunning
    - 3.3: 非运行会话发起请求前用 hasAnyRunning 拦截并提示"有会话正在执行"；handleCancelAgent 作用于当前运行中的桶
    - 3.4: confirmationRequest 绑定发起它的会话桶，切走不串视图

- [✓] Task 4: 会话桶 LRU 上限
    - 4.1: 实现 LRU（保留最近 N=5 个桶），运行中（isRunning）会话豁免淘汰
    - 4.2: 被淘汰会话切回时按 Task 3.1 重载
    - 4.3: 补充 LRU 单测（超限淘汰最久未用、运行中豁免）

- [✓] Task 5: 禁止删除运行中会话
    - 5.1: handleDeleteConversation 开头判断目标会话桶 isRunning，运行中则不删并提示"该会话正在执行，结束后才能删除"
    - 5.2: SidebarPanel 删除按钮对"任一运行中会话"禁用（扩展现有仅对激活会话的禁用逻辑）
    - 5.3: 保留非运行会话的现有删除行为（删激活会话切到最近的、列表空自动新建）

- [✓] Task 6: 验证与回归
    - 6.1: npm run typecheck 通过
    - 6.2: npm test 通过（含新增 session-store / 路由 / LRU 单测）
    - 6.3: 手工验证：切换即时无重载、后台会话生成中切走切回见实时进度、跨会话发送被拦截并提示、运行中会话无法删除、LRU 淘汰后切回重载、重启恢复活动会话、Code 工程会话同样生效
