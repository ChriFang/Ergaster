# MCP Streamable HTTP 支持实施总结

## 结论

MCP 客户端现在同时支持 `stdio` 与 `streamable-http` 两种传输方式。HTTP 使用官方 SDK 的 `StreamableHTTPClientTransport`（已安装版本 1.29.0，lockfile 已固定），未引入任何新依赖。旧的 stdio 配置（`~/.desktop-agent/mcp.json` 中没有 `transport` 字段）无需迁移，读取时按 stdio 解析。

## 改动清单

新增：

- `src/main/mcp-config-utils.ts`：从配置服务中抽出的纯函数层（transport 归一化、URL/headers 校验、列表映射、保存请求校验、连接失效 hash）。不依赖 electron，因此可直接单测。
- `src/main/mcp-transport.ts`：transport 工厂 `createMcpTransport`、日志安全摘要 `describeMcpTarget`、错误翻译 `describeMcpConnectionError`。
- `src/main/mcp-config-utils.test.ts`、`src/main/mcp-transport.test.ts`：共 13 个用例。

修改：

- `src/shared/mcp.ts`：`McpServerConfig` 改为 stdio / streamable-http 可判别联合；列表项新增 `transport`、`url`、`headerKeys`；保存请求新增 `transport`、`url`、`headers`。
- `src/main/mcp-config-service.ts`：只保留文件 I/O 与增删改逻辑，校验与映射改为调用 `mcp-config-utils`。
- `src/main/mcp-service.ts`：连接对象的 transport 改为 SDK 通用 `Transport`；连接、失效 hash、错误处理走新模块；`connect` 失败时关闭半开客户端；`callTool` 失败时输出可读原因并记日志。
- `src/main/agent-profiles-service.ts`：`sanitizeMcpBinding` 改从 `mcp-config-utils` 导入。
- `src/renderer/features/mcp/McpServersPanel.tsx`：新增传输方式选择，按类型分别渲染「命令/参数/环境变量」或「服务地址/请求头」；请求头沿用 `KEY=VALUE` 多行格式；列表副标题按类型展示命令或 URL；启停切换不再丢失 HTTP 字段。
- `package.json`：测试脚本接入两个新测试文件。

## 安全处理

- 渲染层列表接口只返回 header 名称（`headerKeys`），不返回值；编辑态的 header 值来自 `mcp:get-config`，仍只在主进程与设置面板之间流转。
- 日志与错误信息只输出 `origin + pathname` 摘要，剥离 query 与请求头，避免 token 落盘。
- URL 必须能被 `new URL()` 解析且协议为 `http:`/`https:`，非法地址在保存与建立连接两处都会被拒。
- 单个 HTTP 服务不可用只影响该服务的工具加载，其余服务与 Agent 主流程不受影响。

## 验证

- `npm run typecheck`：渲染层与 MCP 相关代码零错误。`agent-service.ts`、`conversation-service.ts`、`token-utils.ts` 中关于 `ChatContentPart` 的报错是本次改动前就存在的，未触碰这些文件。
- `npm test`：52 个用例全部通过。
- `npm run build`：三端构建通过，`dist/main/index.js` 内已包含 Streamable HTTP 传输实现。
- 端到端联调：用 SDK 的 `McpServer` + `StreamableHTTPServerTransport` 起了一个本地 HTTP MCP 服务，通过 `createMcpTransport` 验证了 initialize 握手、`tools/list`、`tools/call` 结果正确，且自定义 `Authorization` 头确实透传到服务端；指向错误路径时客户端得到 404 并被翻译为「该地址不是可用的 Streamable HTTP MCP 端点」。联调脚本为临时文件，已删除。

## 未纳入范围

- OAuth 授权码流程、动态客户端注册、PKCE（SDK 已提供 `authProvider` 接口，后续可在 `createMcpTransport` 内接入）。
- 已废弃的 HTTP+SSE 传输与自动降级。
- HTTP 请求级超时/取消（当前依赖 SDK 默认行为，如需要可通过注入自定义 `fetch` 挂 `AbortSignal`）。
- 凭据迁移到系统 Keychain。
