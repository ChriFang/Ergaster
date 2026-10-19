# 智能体多会话支持任务计划

- [✓] Task 1: 后端——会话标题自动总结（agent-service.ts）
    - 1.1: 提取可测纯函数：标题提示词构造（首轮用户输入+助手回复拼接、超长截断）与结果清洗（去引号/前后缀、slice(0,30)、空值判定）
    - 1.2: 新增模块级函数 generateConversationTitle：复用 createChatCompletion 非流式调用，messages 仅含一条 user 消息（规避 GLM 网关空 assistant 校验），整体 try/catch 失败回退 firstPrompt.slice(0, 80)
    - 1.3: 替换 run() 无工具调用分支中的截断逻辑（agent-service.ts:586-590）为 generateConversationTitle + updateConversationTitle，保留 title === '新会话' 单次触发守卫
    - 1.4: 新增 src/main/agent/agent-service.test.ts，覆盖纯函数清洗/截断与回退行为

- [✓] Task 2: 会话列表状态与操作（use-chat-session.ts）
    - 2.1: 新增 conversationList 状态与 refreshConversationList；switchConversationScope 中将 listConversationsByAgent 结果写入列表，保留"无会话自动创建"兜底
    - 2.2: 新增 handleSelectConversation：setActiveConversationId + loadConversationMessages，isRunning 时阻断切换
    - 2.3: 新增 handleCreateConversation：createConversation(当前 scope) → 激活 + 刷新列表，创建进行中禁用防连点
    - 2.4: 新增 handleDeleteConversation：deleteConversation → 若删除激活会话则切换到列表中下一个（最近更新）会话，列表为空则自动新建 → 刷新列表，isRunning 时激活会话禁止删除
    - 2.5: handleRunAgent 兜底：!conversationId 时先用当前 scope createConversation 再继续执行；run 完成后（loadConversationMessages 处）追加 refreshConversationList 使新标题及时显示

- [✓] Task 3: 侧边栏会话列表 UI（SidebarPanel.tsx + App.tsx + styles.css）
    - 3.1: App.tsx 新增 expandedScopeKey 状态；handleAgentSelection / handleCodeProjectSelection 后设置展开项，再次点击同一项收起；将 conversationList、isRunning 及各回调传入 SidebarPanel
    - 3.2: SidebarPanel 智能体项（默认+自定义）改造为可展开项：点击 = 选中智能体 + 展开/收起切换，带 chevron 指示；展开区渲染会话列表（标题 + 消息数·更新时间 meta、激活会话高亮、hover 删除按钮带确认、isRunning 时激活会话删除禁用）
    - 3.3: 会话列表末项固定渲染"+ 新增会话"项，点击调 onCreateConversation
    - 3.4: Code tab 工程项复用同一可展开结构接入会话列表（scope 为 code:{projectId}）
    - 3.5: styles.css 新增会话下拉列表容器、会话项、删除按钮、新增项样式，沿用现有 app-agent-item / app-workflow-item 视觉体系

- [✓] Task 4: 验证与回归
    - 4.1: 运行 npm run typecheck 通过
    - 4.2: 运行 npm test 通过
    - 4.3: 手工验证：多会话创建/切换/删除（含删除激活会话、删空后自动新建）、首轮标题自动总结与失败回退、Code 工程多会话、运行中删除/切换保护、新智能体未建会话直接聊天

- [✓] Task 5: 修复——标题生成阻塞 run() 导致切换/发送延迟（回归修复）
    - 5.1: shared 新增 ConversationChangedEvent 类型；contracts/preload/desktop-app-client 新增 onConversationChanged 订阅通道（conversation:changed）
    - 5.2: conversation-service 新增 onConversationChanged 监听器注册，updateConversationTitle 落定后发射变更事件
    - 5.3: index.ts 接线 conversationService.onConversationChanged → webContents.send；agent-service 标题生成改为 fire-and-forget（pendingTitleConversations 去重），run() 立即返回释放 abortController
    - 5.4: use-chat-session 订阅事件就地更新 conversationList 对应项标题

- [✓] Task 6: 优化——会话切换渲染耗时（性能优化）
    - 6.1: 临时埋点测量，区分 IPC 取数与渲染提交耗时，确认瓶颈在渲染进程的 markdown 解析
    - 6.2: MessageContent 的 remarkPlugins/components 提为模块级常量并加 memo（891ms → 558ms）
    - 6.3: 首屏分页从 50 条降到 20 条，更早历史按需加载（558ms → 103~247ms）
    - 6.4: 移除临时探针，typecheck 与 npm test 通过

- [✓] Task 7: 会话标题支持手动编辑
    - 7.1: 主进程新增 conversation:rename handler（校验会话存在 → updateConversationTitle，返回 ConversationOperationResult）
    - 7.2: 协议层四层同步：contracts.ts 声明 renameConversation、preload/index.ts 透传、desktop-app-client.ts facade
    - 7.3: use-chat-session 新增 handleRenameConversation（空标题不提交；失败 setLastError；成功依赖 conversation:changed 事件就地更新列表）
    - 7.4: SidebarPanel 会话项编辑态：hover 显示 Pencil 编辑按钮、双击标题进入编辑；单行 input（maxLength=100，Enter/失焦提交、Esc 取消），编辑态互斥；编辑中会话被移出列表时退出编辑
    - 7.5: styles.css 编辑 input 样式；App.tsx 接线 onRenameConversation
    - 7.6: 验证：typecheck + npm test 通过；手工验证改名即时生效、重开应用保持、不会被自动标题覆盖



