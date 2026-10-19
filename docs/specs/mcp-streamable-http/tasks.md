# MCP Streamable HTTP 传输支持实施计划

- [x] Task 1: 扩展共享配置类型以支持传输方式
    - 1.1: 在 `src/shared/mcp.ts` 定义 `McpTransportType`，取值 `stdio` 与 `streamable-http`
    - 1.2: 将 `McpServerConfig` 拆分为 `McpStdioServerConfig` 与 `McpHttpServerConfig` 可判别联合，`transport` 缺省视为 stdio
    - 1.3: 扩展 `McpServerListItem`，新增 `transport`、`url` 字段，并对 headers 做脱敏表达（仅返回 header key 列表或掩码值）
    - 1.4: 扩展 `SaveMcpServerRequest`，支持提交 `transport`、`url`、`headers`，stdio 字段改为可选
    - 1.5: 运行 `npm run typecheck`，记录因类型变更暴露的所有编译错误点，作为后续任务清单依据

- [x] Task 2: 改造配置清洗与校验逻辑
    - 2.1: 在 `src/main/mcp-config-service.ts` 新增 `normalizeHeaders`，仅保留 string-to-string 且 key 非空
    - 2.2: 新增 URL 校验函数，要求可被 `new URL()` 解析且 protocol 为 `http:` 或 `https:`，否则拒绝
    - 2.3: 重写 `normalizeServerConfig`，按 transport 分支校验：stdio 必须有 command，http 必须有合法 url，且不互相残留字段
    - 2.4: 更新 `listMcpServers`，按 transport 输出对应字段，HTTP 服务不返回 header 明文
    - 2.5: 重写 `normalizeSaveRequest`，按 transport 分支给出中文错误信息（如“服务地址不能为空。”“服务地址必须是 http 或 https 链接。”）
    - 2.6: 确认 `sanitizeMcpConfig`、`saveMcpServer`、`deleteMcpServer`、`saveDefaultAgentMcpBinding` 在联合类型下行为不变

- [x] Task 3: 为配置层补充单元测试
    - 3.1: 新建 `src/main/mcp-config-service.test.ts`，覆盖旧 stdio 配置（无 transport 字段）仍可正确解析为 stdio
    - 3.2: 覆盖合法 streamable-http 配置的清洗结果，含 headers 保留
    - 3.3: 覆盖非法场景：缺失 url、非 http scheme、url 非字符串、headers 非对象、stdio 缺失 command
    - 3.4: 覆盖 `listMcpServers` 不泄露 header 明文
    - 3.5: 将新测试文件加入 `package.json` 的 `test` 脚本 esbuild 入口与 `node --test` 参数，执行 `npm test` 通过

- [x] Task 4: 在 MCP 服务层引入 HTTP transport
    - 4.1: 在 `src/main/mcp-service.ts` 引入 `Transport` 类型与 `StreamableHTTPClientTransport`，将 `McpServerConnection.transport` 类型改为通用 `Transport`
    - 4.2: 新增 `createTransport(server)` 工厂，按 transport 分支创建 stdio 或 Streamable HTTP transport，HTTP 通过 `requestInit.headers` 注入自定义 header
    - 4.3: 重写 `buildConfigHash`，按 transport 分支纳入全部有效字段（stdio: command/args/env；http: url/headers），保证 URL 或 header 变更触发重连
    - 4.4: 更新 `connectServer` 使用工厂函数，其余连接、listTools、缓存流程保持不变
    - 4.5: 校验 `closeConnection`、`invalidateServer`、`invalidateAllServers` 对 HTTP transport 依然正确（`client.close()` 会关闭底层 transport）

- [x] Task 5: 加固错误处理与敏感信息保护
    - 5.1: 在 `createTransport` 中对非法 URL 抛出可读中文错误，避免把无效字符串交给 SDK
    - 5.2: 检查 `connectServer`、`getEnabledMcpToolDefinitionsForServerNames`、`callTool` 的日志输出，确保只记录 serverName 与错误摘要，不打印 headers/token
    - 5.3: 为 HTTP 连接失败补充可辨识的错误信息（区分连接失败、认证失败、endpoint 非 MCP 服务）
    - 5.4: 确认 HTTP 服务不可用时仅该服务工具加载失败，不影响其他服务与 Agent 主流程

- [x] Task 6: 为服务层补充单元测试
    - 6.1: 新建 `src/main/mcp-service.test.ts`，抽取可测试的纯函数（`buildConfigHash`、URL 校验/transport 判定）并导出用于测试
    - 6.2: 覆盖 stdio 与 http 配置的 hash 差异，验证 url/header/transport 变化导致 hash 变化
    - 6.3: 覆盖非法 URL 抛错路径
    - 6.4: 将测试文件接入 `package.json` 的 `test` 脚本并执行 `npm test` 通过

- [x] Task 7: 更新 MCP 管理面板 UI
    - 7.1: 在 `src/renderer/features/mcp/McpServersPanel.tsx` 的 `EditorState` 增加 `transport`、`url`、`headersText`
    - 7.2: 新增传输类型选择控件，编辑旧配置默认选中 stdio
    - 7.3: 按 transport 条件渲染表单：stdio 显示命令/参数/环境变量，http 显示服务地址与请求头
    - 7.4: 复用 `KEY=VALUE` 解析逻辑实现 `parseHeadersText`，格式错误时给出明确提示
    - 7.5: 更新 `handleSaveEditor` 与 `handleToggleServer`，按 transport 提交对应字段（HTTP 切换启停时保留 url/headers 不被清空）
    - 7.6: 更新列表项副标题，stdio 显示命令，http 显示 URL

- [x] Task 8: 校验依赖与端到端可用性
    - 8.1: 核对 `package.json` 中 `@modelcontextprotocol/sdk` 版本范围与实际安装版本（当前安装为 1.29.0），必要时锁定明确版本
    - 8.2: 确认 `StreamableHTTPClientTransport` 导入路径在 esbuild 打包主进程后可正常解析
    - 8.3: 执行 `npm run typecheck`、`npm test`、`npm run build` 全部通过
    - 8.4: 使用本地 MCP HTTP 服务（如 SDK 示例的 Streamable HTTP server）验证连接、工具列表、工具调用、修改配置后重连、停用后不可用
