# MCP 工具安全别名修复总结

## 完成内容
- 已将 MCP 工具对模型暴露的名称从直接拼接原始 `serverName/toolName`，改为仅包含字母、数字和下划线的安全别名格式：`mcp_{serverIndex}_{toolIndex}`。
- 已保留原始 MCP 工具的可读描述，继续通过 `description` 展示 `[MCP/{serverName}]` 与原始工具说明。
- 已保留真实执行目标绑定方式，MCP tool 的 `execute` 闭包仍直接调用真实 `serverName` 与原始 `tool.name`，未改变实际 MCP 调用目标。
- 已移除 `tool-registry.ts` 中基于 `mcp__...` 字符串格式的 MCP 名称反解逻辑。
- 已将工具执行链路改为运行时根据当前 `agentId` 重建完整工具表，再按 `function.name` 直接查找对应 `ToolDefinition` 执行。
- 已保证 MCP tool 与系统工具、Skill 工具共享同一执行入口，确认弹窗、审计日志、错误回填逻辑保持一致。

## 关键修改文件
- `src/main/mcp-service.ts`
- `src/main/tool-registry.ts`
- `src/main/agent-service.ts`

## 实现结果
- 即使 MCP server 名称包含中文，如 `12306票务`，也不会再把中文带入 `tools[].function.name`。
- 即使 MCP server 返回的原始 tool 名称包含特殊字符，也不会再直接暴露给模型接口。
- MCP tool call 不再依赖名称正则反解，因此避免了中文、下划线、特殊字符导致的解析失败问题。

## 验证结果
- 已执行 `npm run typecheck`：通过。
- 已执行 `npm run build`：通过。

## 结论
本次修复后，MCP 工具命名已与模型接口的 `^[a-zA-Z0-9_-]+$` 约束解耦，能够兼容中文 server 名和更宽松的原始 MCP tool 名，同时保持现有 UI、配置和 MCP 实际调用行为不变。