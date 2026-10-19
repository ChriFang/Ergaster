# MCP Streamable HTTP 客户端支持调研与设计

## 1. 背景与目标

当前桌面客户端在主进程中通过 `StdioClientTransport` 启动本地 MCP Server，仅支持 `command / args / env` 配置，不支持连接远程或本地 HTTP MCP endpoint。本设计目标是保留现有 stdio 能力，并新增 MCP 官方推荐的 **Streamable HTTP** 传输方式，使用户可以配置如下类型的服务：

```json
{
  "mcpServers": {
    "remote-search": {
      "transport": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      },
      "disabled": false
    }
  },
  "defaultAgent": {
    "enabledServerNames": ["remote-search"]
  }
}
```

本次建议的首个实现范围：

- 支持 `stdio` 和 `streamable-http` 两类配置并存；
- HTTP 使用 SDK 已提供的 `StreamableHTTPClientTransport`；
- 支持用户配置固定 HTTP headers，典型用途是 Bearer/API Key；
- 连接、`tools/list`、`tools/call`、缓存、失效和关闭继续复用现有 MCP 服务抽象；
- 暂不实现完整 OAuth 浏览器授权流程；
- 暂不将已废弃的 HTTP+SSE 作为默认实现，仅在后续确有兼容需求时增加 fallback。

## 2. 现状分析

### 2.1 核心调用链

```text
McpServersPanel
  -> preload window.desktopApp
  -> Electron IPC mcp:save-server / mcp:list-servers
  -> mcp-config-service 保存和清洗 ~/.desktop-agent/mcp.json
  -> mcp-service.connectServer()
  -> Client.connect(transport)
  -> Client.listTools()
  -> ToolDefinition
  -> Client.callTool()
```

### 2.2 关键现有代码

- `/Users/fangruibin/Work/other-code/desktop-tools/src/main/mcp-service.ts:1-246`
  - `McpServerConnection` 将 transport 固定为 `StdioClientTransport`；
  - `connectServer()` 在 `:83-130` 创建 transport、连接并缓存工具；
  - `closeConnection()` 在 `:132-144` 调用 `client.close()`；
  - `getEnabledMcpToolDefinitionsForServerNames()` 在 `:157-201` 将 MCP 工具转换为统一工具；
  - `callTool()` 在 `:218-242` 执行实际 MCP 工具调用。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/shared/mcp.ts:5-32`
  - `McpServerConfig` 和 `SaveMcpServerRequest` 目前只表达命令型服务。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/main/mcp-config-service.ts:43-59,129-150`
  - 目前要求非空 `command`，需要改为按 transport 分支校验。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/renderer/features/mcp/McpServersPanel.tsx:9-61,99-180,229-301`
  - 编辑器目前只有命令、参数、环境变量字段，需要增加传输类型、URL、Header 编辑。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/shared/contracts.ts:131-139`
  - IPC API 类型会因请求/列表类型扩展而自动承接字段，不需要新增 IPC 通道。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/main/mcp-handlers.ts:14-70`
  - 保存、删除和重命名服务时负责失效连接，需要确认扩展配置后的失效逻辑保持不变。

当前安装依赖目录中的 SDK 版本为 `@modelcontextprotocol/sdk@1.29.0`，其导出包含 `StreamableHTTPClientTransport`，类型定义位于：

`/Users/fangruibin/Work/other-code/desktop-tools/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.d.ts:58-116`

其构造形式为：

```ts
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(new URL(server.url), {
  requestInit: {
    headers: server.headers,
  },
  reconnectionOptions: {
    maxRetries: 2,
    initialReconnectionDelay: 1000,
    maxReconnectionDelay: 30000,
    reconnectionDelayGrowFactor: 1.5,
  },
});
await client.connect(transport);
```

## 3. MCP HTTP 规范调研结论

### 3.1 应选择 Streamable HTTP

MCP 当前官方传输方向是：

- `stdio`：本地由客户端启动子进程；
- `Streamable HTTP`：远程服务或独立 HTTP 服务；
- 旧的 HTTP+SSE transport 已被替代/弃用，不应作为新实现的主路径。

Streamable HTTP 使用单一 MCP endpoint：客户端通过 HTTP POST 发送 JSON-RPC 消息，服务端可以返回 JSON 或 `text/event-stream`；GET 可用于服务端消息/SSE 场景。SDK 已封装 Content-Type、Accept、协议握手、session header 和 SSE 响应处理，项目不应自行重写 JSON-RPC HTTP 层。

### 3.2 SDK 能力

当前 `@modelcontextprotocol/sdk@1.29.0` 的 `StreamableHTTPClientTransport` 支持：

- `new URL(endpoint)`；
- `requestInit`，可以注入 headers；
- 可选 `authProvider`，用于 OAuth；
- `reconnectionOptions`；
- 可选 sessionId；
- `close()` 和 `terminateSession()`；
- transport 级 `onerror/onclose/onmessage` 回调。

因此，首版只需新增 transport 选择与配置映射，不需要增加第三方 HTTP 客户端依赖。

### 3.3 认证与安全

首版固定 headers 可以覆盖 Bearer token/API key，但必须注意：

- 配置文件中的 headers 属于敏感信息，列表接口/UI 不应默认把 Authorization 等 secret 展示到日志；
- URL 必须是有效的 `http:` 或 `https:` URL，建议生产环境默认要求 `https:`；
- 禁止通过 renderer 直接发起 MCP 网络请求，仍由 Electron 主进程持有 headers 并调用 SDK；
- 连接错误日志不得打印完整 headers 或 token；
- 对 HTTP MCP 请求设置明确超时/取消策略，避免网络服务阻塞 Agent；若 SDK 的 fetch 注入方式不足，可在后续增加带 AbortSignal 的 fetch wrapper；
- 对用户输入 URL 做协议和格式校验，避免把任意非 HTTP scheme 交给 transport；
- HTTP+SSE fallback 如未来增加，应只在 Streamable HTTP 明确返回兼容性 4xx 时触发，不能对任意网络错误盲目 fallback。

## 4. 设计方案

### 4.1 配置模型

将 `McpServerConfig` 改为可判别联合：

```ts
export type McpTransportType = 'stdio' | 'streamable-http';

type McpBaseServerConfig = {
  disabled?: boolean;
};

export type McpStdioServerConfig = McpBaseServerConfig & {
  transport?: 'stdio'; // 缺省值保持历史配置兼容
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpHttpServerConfig = McpBaseServerConfig & {
  transport: 'streamable-http';
  url: string;
  headers?: Record<string, string>;
};

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;
```

`transport` 对旧配置可缺省并按 `stdio` 解释。HTTP 配置不得要求或保存 command/args/env。配置 hash 必须包含 transport 分支的全部有效字段，确保修改 URL、headers 或 transport 时旧连接会被关闭并重建。

列表/保存请求类型同步使用可判别字段，renderer 可根据 `transport` 显示对应编辑表单。headers 建议沿用现有 `KEY=VALUE` 多行输入格式，以减少 UI 复杂度；Authorization 值在列表与审计日志中不显示。

### 4.2 连接模型

将连接中的 transport 类型从 `StdioClientTransport` 改为 SDK 的通用 `Transport` 类型：

```ts
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

 type McpServerConnection = {
   serverName: string;
   configHash: string;
   client: Client;
   transport: Transport;
   toolsCache: McpListedTool[];
 };
```

新增工厂函数：

```ts
function createTransport(server: McpServerConfig): Transport {
  if (server.transport === 'streamable-http') {
    return new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: {
        headers: server.headers ?? {},
      },
    });
  }

  return new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: server.env,
  });
}
```

`connectServer()`、`listTools()`、`callTool()`、`closeConnection()` 的业务逻辑保持一致。HTTP transport 的连接是惰性的/网络型连接，不应在应用启动时主动连接所有配置服务，继续沿用“绑定工具时连接”的现有策略。

### 4.3 配置与 UI

编辑器增加传输类型选择：

- stdio：名称、命令、参数、环境变量；
- streamable-http：名称、URL、HTTP Headers；
- 编辑旧配置时默认选择 stdio；切换类型前应明确丢弃另一类型未保存字段，或在状态中分别保留，避免用户误丢输入；
- 保存前在主进程再次校验，不依赖 renderer 校验。

为了避免 secret 泄露：

- Header 输入可采用 `KEY=VALUE` 文本框；
- 编辑时从本地配置回显是当前产品行为，但列表、描述、审计日志不显示具体 header；
- 若产品后续需要更强安全性，应将 secret 从普通 JSON 配置迁移到系统 Keychain，而非在本次改造中引入半成品加密。

### 4.4 错误处理

以下错误需要在主进程记录简洁上下文并向现有 UI/Agent 错误链返回可读信息：

- URL 无效或 scheme 不是 http/https；
- HTTP endpoint 404/405/401/403/429/5xx；
- MCP 初始化握手失败；
- `tools/list` 失败；
- 连接断开或重连耗尽；
- HTTP 服务返回不符合 MCP 的响应；
- 配置修改后旧连接关闭失败。

错误日志只能包含 serverName、endpoint 的非敏感摘要和错误状态，不打印 headers。

### 4.5 数据流

```text
用户在 MCP 面板选择 streamable-http
  -> 输入名称、URL、headers
  -> preload IPC mcp:save-server
  -> main sanitizeMcpConfig 校验并写入 ~/.desktop-agent/mcp.json
  -> agent 获取已绑定 serverName
  -> mcpService.connectServer
  -> createTransport(http)
  -> Client.connect(StreamableHTTPClientTransport)
  -> Client.listTools
  -> 生成内部 mcp_* ToolDefinition
  -> 模型发起工具调用
  -> mcpService.callTool
  -> Client.callTool
  -> 统一 ToolResult 返回 Agent
```

### 4.6 测试策略

至少增加以下测试覆盖：

1. 配置清洗：旧 stdio 配置仍可读取；HTTP URL/headers 可保存；非法 URL、非法 headers 被拒绝；
2. transport 工厂：stdio 创建 `StdioClientTransport`，HTTP 创建 `StreamableHTTPClientTransport`；
3. 配置 hash：URL、header、transport 任一变化都会导致连接失效；
4. MCP service：mock `Client`/transport 或 mock HTTP fetch，验证 listTools、callTool、close；
5. 错误安全：认证 token 不出现在日志或错误信息中；
6. 构建与类型检查：`npm run typecheck`、`npm test`、`npm run build`。

## 5. 影响文件

预计修改文件：

- `/Users/fangruibin/Work/other-code/desktop-tools/src/shared/mcp.ts`
  - 扩展 transport 联合类型、HTTP 字段和列表/保存请求字段。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/main/mcp-config-service.ts`
  - 分支清洗、URL/header 校验、列表映射和保存逻辑。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/main/mcp-service.ts`
  - 引入通用 Transport、HTTP transport 工厂、HTTP 配置 hash 和安全错误处理。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/renderer/features/mcp/McpServersPanel.tsx`
  - 增加 transport 选择及 URL/header 表单；stdio/http 字段条件渲染。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/main/mcp-handlers.ts`
  - 校验/保存后的失效逻辑审查，必要时补充敏感字段处理。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/main/mcp-service.test.ts`（如现有测试组织允许新增）
  - 新增 transport 与连接行为测试。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/main/mcp-config-service.test.ts`（如现有测试组织允许新增）
  - 新增配置兼容和校验测试。
- `/Users/fangruibin/Work/other-code/desktop-tools/package.json` / lockfile
  - 通常无需新增依赖；若实际 SDK 导出与 lockfile 不一致，再统一升级/锁定 SDK 版本。

## 6. 边界与未纳入范围

- 不支持将任意 URL 当作可执行命令；
- 不在 renderer 侧保存或发送网络请求；
- 不把旧 HTTP+SSE 当作首版 HTTP 实现；
- 不在首版实现 OAuth callback、动态客户端注册、PKCE 和系统浏览器回调；
- 不改变已有 MCP 工具 alias、risk、schema 归一化及 Agent 调用协议；
- 不改变 Agent Profile 的 MCP 绑定数据结构；
- 远端服务的可用性、权限和工具列表变化属于运行时错误，需要可观测但不应导致整个 Agent 崩溃。

## 7. 预期结果

完成后，用户可在 MCP 管理面板中分别配置本地 stdio Server 和远程 Streamable HTTP Server。两者会通过同一套工具发现、工具注册、模型调用、缓存和关闭流程工作；旧的 stdio 配置无需迁移。HTTP 认证首版通过固定 headers 支持，OAuth 和旧 SSE 兼容作为后续独立需求处理。