# MCP 智能体工具接入方案

## 背景与目标
基于 `e:\other-code\desktop-tools\doc\MCP.md` 的要求，为当前 Electron + React 桌面应用新增 MCP（Model Context Protocol）能力，目标包括：

1. 在主进程实现 MCP Client，支持接入一个或多个 MCP Server。
2. 提供 MCP Server 配置管理 UI，支持查看、新增、编辑、删除。
3. 将 MCP 配置保存到 `C:\Users\【用户名】\.desktop_tools\mcp.json`。
4. 支持按智能体启用/禁用 MCP Server，且“默认模式”也可单独配置。
5. 会话运行时根据当前智能体汇总已启用 MCP Server 的 tools，并与现有 tools / skills 一起传给模型。
6. 模型触发 MCP tool call 时，能够由主进程路由到对应 MCP Server 执行并回填结果。

## 当前项目现状

### 应用结构
- 主进程入口：`e:\other-code\desktop-tools\src\main\index.ts`
- 渲染进程入口：`e:\other-code\desktop-tools\src\renderer\main.tsx`
- Electron bridge：`e:\other-code\desktop-tools\src\preload\index.ts`
- 聊天主流程：`e:\other-code\desktop-tools\src\main\agent-service.ts`
- 工具注册与执行：`e:\other-code\desktop-tools\src\main\tool-registry.ts`
- 智能体存储与 CRUD：`e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`
- 智能体编辑 UI：`e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
- 主界面菜单和弹窗：`e:\other-code\desktop-tools\src\renderer\App.tsx`

### 已有能力和约束
1. 当前工具列表是全局的，由 `getRegisteredTools()` 统一返回，未按智能体区分。
2. 当前智能体差异只体现在 system prompt，不体现在 tool 能力范围。
3. 当前已有可靠的主进程工具执行回路，可复用 MCP tool 调用接入点。
4. 当前未引入 MCP SDK，需要新增依赖，并保证可被 Electron main + esbuild 打包。
5. 当前没有测试框架，验收主要依赖 `typecheck` 与 `build`。

## 需求拆解

### 场景 1：管理 MCP Server 配置
#### 处理逻辑
用户在“更多”菜单中打开 “MCP 服务” 页面后，可以：
- 查看已配置 MCP Server 列表
- 新增 stdio 类型 MCP Server
- 编辑 server 名称、启动命令、参数、环境变量、禁用状态
- 删除 server
- 保存配置到 `~/.desktop_tools/mcp.json`

#### 配置格式
参照 `C:\Users\fangruibin\.comate\mcp.json`，本项目采用以下兼容结构：

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "***"
      },
      "disabled": false
    }
  },
  "defaultAgent": {
    "enabledServerNames": ["github"]
  }
}
```

#### 设计说明
- `mcpServers` 保存全局 server 定义。
- `defaultAgent.enabledServerNames` 保存默认模式启用的 server 列表。
- 具体智能体启用关系不放在 `mcp.json`，而存入各自 `agent.json`，避免全局配置与智能体元数据双向耦合。

### 场景 2：按智能体启用/禁用 MCP
#### 处理逻辑
- 默认模式支持选择 0~N 个 MCP Server。
- 自定义智能体也支持选择 0~N 个 MCP Server。
- 若某个 server 在全局配置中 `disabled=true`，则：
  - 编辑页面中可展示但不可生效，或提示“服务已全局禁用”。
  - 会话运行时自动从可用工具集合中过滤。

#### 智能体存储方案
扩展 `agent.json` 元数据：

```json
{
  "id": "meeting-assistant",
  "title": "会议纪要助手",
  "createdAt": "2026-06-01T00:00:00.000Z",
  "updatedAt": "2026-06-01T00:00:00.000Z",
  "mcp": {
    "enabledServerNames": ["github", "time"]
  }
}
```

默认模式不落盘到 agents 目录，而是存于 `mcp.json` 下的 `defaultAgent` 字段。

### 场景 3：会话中注入 MCP Tools
#### 处理逻辑
当用户选择某个智能体发送消息时：
1. 读取当前智能体或默认模式的 MCP 绑定。
2. 读取所有已配置 server。
3. 过滤出已启用且未全局禁用的 server。
4. 建立或复用这些 server 对应的 MCP client 连接。
5. 对每个 server 执行 `listTools()`。
6. 将返回的 tools 转换为当前模型接口需要的 OpenAI-compatible tool schema。
7. 与现有系统 tools、skills 一起传入 `createChatCompletion()`。
8. 若模型返回 MCP tool call，则按 tool 名称路由回对应 server 执行 `callTool()`。

#### 数据流路径
```text
Renderer MCP 配置页
  -> preload API
  -> IPC handler
  -> main/mcp-config-service.ts
  -> ~/.desktop_tools/mcp.json

Renderer 智能体编辑页
  -> preload API
  -> IPC handler
  -> main/agent-profiles-service.ts
  -> ~/.desktop_tools/agents/<id>/agent.json

聊天发送
  -> main/agent-service.ts
  -> main/mcp-service.ts 汇总启用 server 与 tools
  -> main/tool-registry.ts 组装系统 tools + skills + MCP tools
  -> deepseek-client.ts 发给模型
  -> 模型返回 tool_calls
  -> tool-registry.ts 路由到 mcp-service.ts
  -> MCP Server 执行
  -> tool result 回填模型下一轮
```

### 场景 4：区分 MCP tools、现有 tools、skills
#### 结论
运行机制上不做三套调用链，统一按“tool”提供给模型；但在内部元数据和 UI 文案上明确来源分类：
- `system`：内置工具，如 `read_file`
- `skill`：用户 Skill 暴露出的工具
- `mcp`：来自 MCP Server 的工具

#### 原因
- 模型接口本身只需要统一的 tool schema，没必要在协议层拆三种调用机制。
- 统一调度可以最小化对现有 agent loop 的侵入。
- 保留来源字段后，后续可以在审计日志、确认弹窗、调试信息中区分调用来源。

#### 具体策略
为工具注册项增加来源元数据：

```ts
source: {
  type: 'system' | 'skill' | 'mcp';
  serverName?: string;
  skillName?: string;
}
```

MCP tool 对外名称使用命名空间前缀避免冲突：

```text
mcp__github__list_issues
mcp__time__get_current_time
```

这样可以避免：
- 不同 server 提供同名 tool
- MCP tool 与现有系统 tool / skill tool 重名

模型看到的是唯一 tool 名称；执行时再反解为 `serverName + originalToolName`。

## 技术方案

## 1. 新增 MCP 配置与连接服务
新增主进程服务层，推荐拆分为：

### `e:\other-code\desktop-tools\src\main\mcp-config-service.ts`
职责：
- 管理 `~/.desktop_tools/mcp.json` 的读写
- 规范化配置结构
- 校验 server name / command / args / env
- 提供默认模式 MCP 绑定读写接口

建议类型：

```ts
export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
};

export type McpAgentBinding = {
  enabledServerNames: string[];
};

export type McpConfig = {
  mcpServers: Record<string, McpServerConfig>;
  defaultAgent?: McpAgentBinding;
};
```

### `e:\other-code\desktop-tools\src\main\mcp-service.ts`
职责：
- 基于 MCP SDK 管理 stdio client 连接池
- server 级别 connect / reconnect / close
- 读取指定 server 的 tool 列表
- 执行指定 MCP tool call
- 把 MCP tool 映射为本项目统一 tool 定义

推荐使用官方 SDK：

```ts
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
```

#### 连接策略
- 首期仅支持 `stdio` server。
- 按 serverName 懒加载连接。
- 工具调用或列工具时若连接不存在，则自动连接。
- 若连接失败，记录日志并在当次会话中过滤该 server 的 tools。
- 配置更新或删除 server 时，关闭旧连接并清缓存。

#### 连接缓存结构

```ts
type McpServerConnection = {
  serverName: string;
  configHash: string;
  client: Client;
  transport: StdioClientTransport;
  toolsCache: McpListedTool[];
  connectedAt: string;
};
```

## 2. 扩展智能体元数据
修改 `e:\other-code\desktop-tools\src\shared\agent-profile.ts` 与 `e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`：
- 为 `AgentProfileMetadata`、`AgentProfileDetail`、`CreateAgentProfileRequest`、`UpdateAgentProfileRequest` 增加 MCP 绑定字段。
- `agent.json` 持久化该字段。
- 旧数据兼容：若 `mcp` 字段不存在，则视为 `enabledServerNames=[]`。

建议定义：

```ts
export type AgentMcpSettings = {
  enabledServerNames: string[];
};
```

## 3. 扩展 preload / IPC / shared contracts
需要在以下位置增加 MCP API：
- `e:\other-code\desktop-tools\src\shared\contracts.ts`
- `e:\other-code\desktop-tools\src\preload\index.ts`
- 新增 `e:\other-code\desktop-tools\src\main\mcp-handlers.ts`
- `e:\other-code\desktop-tools\src\main\index.ts` 注册 handler

建议接口：

```ts
listMcpServers(): Promise<McpServerListItem[]>
getMcpConfig(): Promise<McpConfig>
saveMcpConfig(config: McpConfig): Promise<McpConfig>
getDefaultAgentMcpSettings(): Promise<AgentMcpSettings>
saveDefaultAgentMcpSettings(settings: AgentMcpSettings): Promise<AgentMcpSettings>
```

如果 UI 采用整页保存，也可以简化为：

```ts
getMcpConfig(): Promise<McpConfig>
saveMcpConfig(config: McpConfig): Promise<McpConfig>
```

## 4. 扩展工具注册中心
修改 `e:\other-code\desktop-tools\src\main\tool-registry.ts`。

### 当前问题
`getRegisteredTools()` 无参数，直接返回全局系统 tool + skill tool，无法按当前智能体动态注入 MCP tools。

### 目标改造
改为支持基于上下文生成工具集，例如：

```ts
async function getRegisteredToolsForAgent(input: {
  agentId?: string;
}): Promise<ToolDefinition<unknown>[]>;
```

工具来源：
1. 系统内置 tools
2. 用户 skills tools
3. 当前智能体启用的 MCP tools

### MCP tool 映射示例

```ts
{
  name: 'mcp__github__search_repositories',
  description: '[MCP/github] Search repositories',
  risk: 'low',
  strict: true,
  parameters: tool.inputSchema,
  execute: async (args, context) => {
    return mcpService.callTool({
      serverName: 'github',
      toolName: 'search_repositories',
      args,
      signal: context.signal,
    });
  },
  source: {
    type: 'mcp',
    serverName: 'github',
  },
}
```

### 风险等级策略
首版建议：
- MCP tools 默认 `risk: 'low'`
- 保持与现有工具确认机制兼容
- 后续再考虑基于 tool 名称或配置做细粒度风险分级

## 5. 改造聊天主流程
修改 `e:\other-code\desktop-tools\src\main\agent-service.ts`：
- 将 `getRegisteredTools()` 改为按 `agentId` 异步获取。
- 在每次请求开始前，按当前智能体实时汇总可用工具。
- 若某个 MCP server 无法连接，不中断整个会话，仅跳过该 server 并记录日志。

建议调整为：

```ts
const tools = await getRegisteredToolsForAgent({ agentId });
```

这样默认模式和自定义智能体都能拿到不同工具集合。

## 6. 渲染层 UI 方案

### 菜单入口
修改 `e:\other-code\desktop-tools\src\renderer\App.tsx`：
- 在“更多”下新增 “MCP 服务” 菜单项
- 新增弹窗状态 `showMcpModal`
- 弹出 `McpServersPanel`

### MCP 服务面板
新增：`e:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`

功能调整为两级页面流转：

#### 列表页
- 打开面板后默认仅展示 MCP server 列表
- 每一项只展示：server 名称、编辑按钮、删除按钮
- 点击删除按钮后立即删除该 server
- 若该 server 已被默认模式或任一智能体引用，需要同步移除所有引用关系
- 双击列表项或点击编辑按钮，进入该 server 的编辑页
- 列表页提供“新增 MCP 服务”入口，进入新建页

#### 编辑页 / 新建页
- 展示并编辑以下字段：`server 名称`、`command`、`args`、`env`、`disabled`
- `args` 使用多行文本，一行一个参数
- `env` 使用多行 `KEY=VALUE`
- 保存时支持两类联动：
  - 如果是重命名 server，需要同步更新默认模式与所有智能体中的引用名称
  - 如果是普通字段更新（如 command、args、env、disabled），所有已引用该 server 的智能体无需单独修改绑定关系，但后续运行自动使用新配置

### 智能体编辑页
修改 `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
- 增加“已添加 MCP 服务”列表展示
- 每个已添加项后增加显眼的删除按钮（红色风格），点击后从当前智能体移除该 MCP server
- 增加“添加 MCP 服务”按钮
- 点击后切换到全局 MCP server 列表选择页
- 选择页展示所有全局 MCP server
- 已经添加到当前智能体的 server 显示为“已添加”状态，且不可重复添加
- 新增添加动作后，立即回写到当前编辑态的 `enabledServerNames`

修改 `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`
- 加载智能体详情时携带 MCP 字段
- 保存时传递 MCP 字段
- 在智能体编辑态与 MCP 选择页之间维护切换状态

## 7. 兼容性与异常处理

### 边界条件
1. `mcp.json` 不存在：自动创建默认空配置。
2. `mcp.json` 格式错误：记录日志，回退为空配置，避免主流程崩溃。
3. server 名称重复：保存时禁止。
4. command 为空：保存时禁止。
5. args / env 文本解析失败：在 UI 层阻止保存并提示具体错误。
6. 已绑定到智能体的 server 被删除：会话运行时自动忽略；编辑页面不再显示为勾选项。
7. MCP server 全局禁用但仍被智能体绑定：会话运行时忽略，UI 中给出禁用提示。
8. MCP server 连接失败：仅跳过该 server，不影响其他 tools 和主对话。
9. 不同 server tool 名冲突：使用 `mcp__{serverName}__{toolName}` 规避。
10. MCP tool 返回非文本块：首版将文本块拼接返回；非文本块可序列化为 JSON 文本兜底。

### 安全考虑
1. MCP Server 命令由本地用户配置，属于高权限执行入口，但符合该功能定位。
2. 环境变量可能包含敏感信息：
   - 存储时按原样保存到本地配置文件。
   - UI 展示时可明文编辑，首版不做脱敏保存逻辑。
   - 日志中禁止输出完整 env 内容。
3. 不自动信任 MCP tool 的 schema 之外参数。
4. 调用 MCP tool 时仅传模型提供的 JSON 参数对象。

## 受影响文件

### 必改文件
- `e:\other-code\desktop-tools\package.json`
  - 新增 MCP SDK 依赖
- `e:\other-code\desktop-tools\src\shared\agent-profile.ts`
  - 扩展智能体 MCP 类型
- `e:\other-code\desktop-tools\src\shared\contracts.ts`
  - 扩展 preload API 类型
- `e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`
  - 持久化智能体 MCP 配置
- `e:\other-code\desktop-tools\src\main\agent-service.ts`
  - 按智能体动态获取工具集
- `e:\other-code\desktop-tools\src\main\tool-registry.ts`
  - 注入 MCP tools 并统一调度
- `e:\other-code\desktop-tools\src\main\index.ts`
  - 注册 MCP handlers，启动时初始化相关服务
- `e:\other-code\desktop-tools\src\preload\index.ts`
  - 暴露 MCP API
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - 菜单入口和弹窗挂载
- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
  - 智能体 MCP 勾选 UI
- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`
  - 保存智能体 MCP 字段

### 新增文件
- `e:\other-code\desktop-tools\src\shared\mcp.ts`
  - MCP 共享类型定义
- `e:\other-code\desktop-tools\src\main\mcp-config-service.ts`
  - MCP 配置读写
- `e:\other-code\desktop-tools\src\main\mcp-service.ts`
  - MCP client 连接与 tool 调用
- `e:\other-code\desktop-tools\src\main\mcp-handlers.ts`
  - IPC handlers
- `e:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`
  - MCP 服务管理界面

## 关键实现片段

### 根据当前智能体汇总 MCP tools
```ts
async function resolveEnabledMcpServerNames(agentId?: string): Promise<string[]> {
  if (agentId) {
    const agent = agentProfilesService.getAgentDetail(agentId);
    return agent?.mcp?.enabledServerNames ?? [];
  }

  const config = await mcpConfigService.loadConfig();
  return config.defaultAgent?.enabledServerNames ?? [];
}
```

### MCP tool 名称映射
```ts
function buildMcpToolAlias(serverName: string, toolName: string) {
  return `mcp__${serverName}__${toolName}`;
}

function parseMcpToolAlias(alias: string) {
  const match = /^mcp__([^_]+?)__(.+)$/.exec(alias);
  if (!match) {
    return null;
  }

  return {
    serverName: match[1],
    toolName: match[2],
  };
}
```

### stdio MCP client 连接
```ts
const client = new Client({
  name: 'desktop-tools-mcp-client',
  version: '0.1.0',
});

const transport = new StdioClientTransport({
  command: server.command,
  args: server.args ?? [],
  env: server.env,
});

await client.connect(transport);
const toolList = await client.listTools();
```

## 预期结果
1. 菜单中可打开 MCP 服务管理页面。
2. 用户可以维护 `~/.desktop_tools/mcp.json`。
3. 默认模式和每个智能体都能独立选择启用哪些 MCP Server。
4. 会话请求会按当前智能体动态携带不同 MCP 工具集合。
5. 模型可以直接调用 MCP tool，并拿到返回结果继续推理。
6. MCP、系统 tool、skill tool 在内部来源上可区分，但对模型调用链保持统一。

## 本次实现范围决策
本次实现只覆盖：
- MCP Client（stdio）
- MCP Server 本地配置管理
- 默认模式 / 智能体级别绑定
- tool 注入与执行链路

暂不覆盖：
- SSE / WebSocket 类型 MCP transport
- MCP tool 图形化调试面板
- MCP tool 风险等级精细配置
- 密钥托管或 env 加密存储

## 需要你确认的地方
当前方案已经按最小可落地路径收敛，建议直接按此方案继续。如果你希望调整，我建议只需要确认下面 2 点：

1. 是否接受“首版仅支持 stdio 类型 MCP Server”？
2. 是否接受“默认模式的 MCP 绑定保存到 `mcp.json`，自定义智能体绑定保存到各自 `agent.json`”？

如果这两个点没有异议，我就继续整理详细任务清单。