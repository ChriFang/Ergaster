# MCP 智能体工具接入实现总结

## 完成内容
- 已新增 MCP 共享类型与配置模型，支持全局 MCP server 配置、默认模式绑定和智能体级别绑定。
- 已实现主进程 `mcp-config-service` 与 `mcp-service`，支持从 `~/.desktop_tools/mcp.json` 读取配置、通过 stdio 连接 MCP server、拉取 tools 并执行 tool call。
- 已完成 MCP IPC 与 preload 桥接，渲染进程可读取配置、保存 server、删除 server、保存默认模式绑定并获取配置文件路径。
- 已改造工具注册链路，当前会话会按 `agentId` 动态拼装 system tools、skills 和 MCP tools；MCP tools 使用 `mcp__{serverName}__{toolName}` 命名，并标记 `source.type = 'mcp'`。
- 已完成 MCP 工具结果文本化处理，优先拼接 text block，其他结果结构回退为 JSON 序列化。
- 已完成 MCP 服务面板两级 UI：
  - 列表页仅展示 server 名称、编辑、删除
  - 支持双击列表项进入编辑页
  - 删除 server 时同步移除默认模式和所有智能体中的引用
  - 编辑时支持名称、命令、参数、环境变量、关闭状态
  - server 重命名时同步更新默认模式和所有智能体引用
- 已完成智能体编辑页 MCP 交互改造：
  - 展示已添加 MCP 服务列表
  - 每项支持红色删除按钮
  - 通过“添加 MCP 服务”进入全局列表选择页
  - 已添加项显示“已添加”且不可重复添加
- 已完成旧版智能体数据兼容，缺失 `mcp` 字段的历史 `agent.json` 会自动补齐默认结构。

## 关键文件
- `src/shared/mcp.ts`
- `src/shared/agent-profile.ts`
- `src/shared/contracts.ts`
- `src/shared/tools.ts`
- `src/main/mcp-config-service.ts`
- `src/main/mcp-service.ts`
- `src/main/mcp-handlers.ts`
- `src/main/tool-registry.ts`
- `src/main/agent-profiles-service.ts`
- `src/main/agent-service.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/renderer/App.tsx`
- `src/renderer/features/mcp/McpServersPanel.tsx`
- `src/renderer/features/agents/AgentsPanel.tsx`
- `src/renderer/features/agents/AgentEditor.tsx`
- `src/renderer/styles.css`
- `package.json`

## 实现决策
- MCP tool 风险等级按要求统一使用 `low`。
- MCP tool 名称采用 `mcp__{serverName}__{toolName}`，避免与系统工具、skills 及多 server 同名工具冲突。
- 默认模式 MCP 绑定存放在 `mcp.json`，普通智能体绑定存放在各自元数据中，避免职责混杂。
- 当某个 MCP server 不可用时，工具注册链路跳过该 server，不中断主对话。

## 验证结果
- 已执行 `npm install`
- 已执行 `npm run typecheck`
- 已执行 `npm run build`
- 已修复 MCP SDK 接入过程中的类型问题与脚本环境问题，最终类型检查和构建均通过。

## 结果
- MCP server 现已可配置并持久化。
- 默认模式与智能体模式均可独立启用 MCP server。
- 会话会按当前智能体自动注入可用 MCP tools。
- MCP server 删除、重命名与智能体引用之间的联动已打通。