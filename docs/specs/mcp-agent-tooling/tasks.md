# MCP 智能体工具接入任务清单
- [x] 任务 1：补齐 MCP 共享类型、配置存储与智能体绑定模型
    - 1.1：在 `src/shared/mcp.ts` 定义 MCP server、默认模式绑定、列表项与保存结构类型
    - 1.2：扩展 `src/shared/agent-profile.ts`，为智能体详情、请求参数、元数据增加 `mcp.enabledServerNames`
    - 1.3：扩展 `src/shared/contracts.ts`，增加 MCP 配置读取/保存相关 preload API 类型
    - 1.4：新增 `src/main/mcp-config-service.ts`，负责 `~/.desktop_tools/mcp.json` 的读取、规范化、保存与默认模式绑定管理
    - 1.5：改造 `src/main/agent-profiles-service.ts`，兼容旧版 `agent.json` 并持久化 MCP 绑定字段
    - 1.6：补充 server 删除/重命名后的引用联动能力，支持默认模式和所有智能体的绑定同步清理或更新

- [x] 任务 2：实现主进程 MCP client、IPC 和工具注入执行链路
    - 2.1：在 `package.json` 增加官方 MCP SDK 依赖，并确保适配现有 Electron + esbuild 构建
    - 2.2：新增 `src/main/mcp-service.ts`，实现 stdio MCP client 连接池、listTools、callTool、连接失效重建和关闭逻辑
    - 2.3：新增 `src/main/mcp-handlers.ts`，提供 MCP 配置读取、保存、删除、重命名联动所需 IPC handler
    - 2.4：修改 `src/main/index.ts` 注册 MCP handlers，并在必要位置初始化相关服务
    - 2.5：改造 `src/main/tool-registry.ts`，支持按当前智能体动态拼装 system tools、skills、MCP tools，并为 MCP tool 打上 `mcp` 来源元数据
    - 2.6：使用 `mcp__{serverName}__{toolName}` 作为 MCP tool 对外名称，解决与 system tools、skills 及多 server 同名 tool 的冲突
    - 2.7：修改 `src/main/agent-service.ts`，按当前 `agentId` 异步获取工具列表，并在 MCP server 不可用时跳过该 server 而不中断主对话
    - 2.8：实现 MCP tool 结果文本化回填，兼容 text block 与非 text block 的序列化兜底

- [x] 任务 3：接入 preload 桥接与 MCP 服务面板两级 UI
    - 3.1：修改 `src/preload/index.ts` 暴露 MCP 配置读取、保存及相关操作接口
    - 3.2：修改 `src/renderer/App.tsx`，在“更多”菜单增加 “MCP 服务” 入口并挂载 MCP 面板弹窗
    - 3.3：新增 `src/renderer/features/mcp/McpServersPanel.tsx`，默认展示 MCP server 列表页，每项仅显示 server 名称、编辑按钮、删除按钮
    - 3.4：在 MCP 列表页实现删除动作；删除某个 server 时联动移除默认模式和所有智能体中的对应引用
    - 3.5：在 MCP 列表页支持点击编辑按钮或双击列表项进入 server 编辑页，并支持“新增 MCP 服务”进入新建页
    - 3.6：在 MCP 编辑页实现 `MCP 名称`、`命令`、`参数`、`环境变量`、`关闭` 的编辑与保存校验
    - 3.7：保存 MCP 编辑结果时，若发生 server 重命名，同步更新默认模式和所有智能体中的引用名称

- [x] 任务 4：改造智能体编辑页的 MCP 列表与选择交互
    - 4.1：修改 `src/renderer/features/agents/AgentsPanel.tsx`，加载并保存带 MCP 字段的智能体详情
    - 4.2：修改 `src/renderer/features/agents/AgentEditor.tsx`，展示当前智能体“已添加 MCP 服务”列表
    - 4.3：为每个已添加 MCP 服务增加显眼的删除按钮，点击后从当前编辑态移除该 server
    - 4.4：增加“添加 MCP 服务”按钮，并切换到全局 MCP server 列表选择页
    - 4.5：在选择页展示所有全局 MCP server；已添加项标记为“已添加”且不可重复添加
    - 4.6：选择某个未添加 MCP server 后立即加入当前智能体编辑态，并支持返回智能体主编辑页继续保存
    - 4.7：确保默认模式的 MCP 绑定保存仍由 MCP 配置面板管理，不混入普通智能体编辑逻辑

- [x] 任务 5：完成验证与交付收尾
    - 5.1：自查 MCP 配置保存、server 删除联动、server 重命名联动、智能体添加/移除 MCP、会话工具注入等关键流程
    - 5.2：执行 `npm install`、`npm run typecheck`、`npm run build`，处理新增依赖和编译问题
    - 5.3：回写 `tasks.md` 勾选状态，确保所有顶层任务完成后生成 `summary.md`
