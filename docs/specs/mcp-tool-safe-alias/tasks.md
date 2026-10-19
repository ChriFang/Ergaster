# MCP 工具安全别名修复任务清单
- [x] 任务 1：改造 MCP 工具别名生成逻辑为安全名称
    - 1.1：修改 `src/main/mcp-service.ts`，移除直接拼接 `mcp__{serverName}__{toolName}` 的命名方式
    - 1.2：为当前启用的 MCP tools 生成仅包含字母、数字、下划线的安全别名，例如 `mcp_0_0`
    - 1.3：保持 MCP tool 的 `description`、`source.serverName` 和 `execute` 闭包仍绑定真实 `serverName` 与原始 `tool.name`
    - 1.4：确保不同 server 与不同 tool 的别名不冲突，并在同一次工具构建中稳定可复现

- [x] 任务 2：改造 MCP 工具执行链路，移除名称反解依赖
    - 2.1：修改 `src/main/tool-registry.ts`，移除或停用基于正则的 `parseMcpToolName()` 解析逻辑
    - 2.2：调整 MCP tool 执行逻辑，不再通过 `function.name` 反解 `serverName` 和 `toolName`
    - 2.3：让 MCP tool 与系统工具一样，通过当前运行时注册的 `ToolDefinition` 映射直接执行
    - 2.4：保持确认弹窗、审计日志与错误回填行为不变，并继续标记 MCP 工具为 `low` 风险

- [x] 任务 3：完成验证与交付收尾
    - 3.1：自查中文 server 名、特殊字符 tool 名场景下的工具注册与调用链路
    - 3.2：执行 `npm run typecheck` 与 `npm run build`，修复新增问题
    - 3.3：回写 `tasks.md` 勾选状态，并在完成后生成 `summary.md`
