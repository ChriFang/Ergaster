# MCP 工具安全别名修复方案

## 背景与问题
当前 MCP 工具在注册给模型时，直接使用 `mcp__{serverName}__{toolName}` 作为 `tools[].function.name`。这一实现位于：

- `e:\other-code\desktop-tools\src\main\mcp-service.ts`
- `e:\other-code\desktop-tools\src\main\tool-registry.ts`

现有实现的问题是，模型接口要求 `function.name` 必须匹配正则：

```text
^[a-zA-Z0-9_-]+$
```

但当前别名直接拼接原始 `serverName` 与原始 `toolName`，会引入以下非法字符：
- 中文
- 空格
- 点号、冒号、斜杠等特殊字符
- 其他不满足接口约束的 Unicode 字符

例如当前配置文件 `C:\Users\fangruibin\.desktop_tools\mcp.json` 中存在：

```json
{
  "mcpServers": {
    "12306票务": {
      "command": "node"
    }
  }
}
```

在此情况下，生成的 MCP 工具名会类似：

```text
mcp__12306票务__query_ticket
```

该名称包含中文，发送到模型接口时会直接触发：

```text
Invalid 'tools[i].function.name': string does not match pattern '^[a-zA-Z0-9_-]+$'
```

此外，当前 `tool-registry.ts` 的 MCP 名称解析逻辑：

```ts
/^mcp__([^_]+?)__(.+)$/
```

还隐含要求 `serverName` 不能包含下划线，这会进一步放大兼容性问题。

## 修复目标
1. MCP tool 对外暴露给模型的 `function.name` 必须始终满足 `^[a-zA-Z0-9_-]+$`。
2. 不要求用户修改已有 MCP server 名称，也不要求 MCP server 自身返回合法 tool 名。
3. 保持现有 MCP UI、配置文件结构、主流程调用方式不变。
4. 保持工具调用时仍能准确路由到原始 `{ serverName, toolName }`。
5. 在多 server、多 tool 场景下保持别名唯一且可预测。

## 方案结论
不再把原始 `serverName` / `toolName` 直接拼到 `function.name` 中，而是改为引入**安全别名层**。

### 核心策略
- 对外暴露给模型的 MCP 工具名统一改为安全格式，例如：

```text
mcp_0
mcp_1
mcp_2
```

或同类仅包含英文字母、数字、下划线、短横线的名字。

- 在主进程内部维护“安全别名 -> 原始 MCP 目标”映射：

```ts
type McpToolAliasRecord = {
  alias: string;
  serverName: string;
  toolName: string;
};
```

- 模型只看到安全别名。
- 实际执行时，通过映射表把安全别名反解为原始 `serverName` 和 `toolName`，再调用 MCP server。

## 设计细节

### 别名生成规则
建议将 MCP 工具别名改为稳定且纯 ASCII 的形式：

```ts
mcp_{serverIndex}_{toolIndex}
```

例如：
- `mcp_0_0`
- `mcp_0_1`
- `mcp_1_0`

其中：
- `serverIndex` 基于当前启用的 server 列表顺序
- `toolIndex` 基于对应 server 返回的 tools 顺序

这样可以保证：
- 100% 满足接口命名正则
- 不依赖用户配置名是否合法
- 不依赖 MCP server 返回的 tool 名是否合法
- 不需要做复杂转义和正反编码

### 显示与执行分离
工具元数据仍保留可读描述：

```ts
{
  name: 'mcp_0_0',
  description: '[MCP/12306票务] 查询余票',
  source: {
    type: 'mcp',
    serverName: '12306票务',
  }
}
```

也就是说：
- `name` 用于模型协议和 tool call
- `description` 用于给模型提供语义信息
- `source.serverName` 用于内部审计和日志

### 映射维护位置
优先在 `src/main/mcp-service.ts` 中生成并返回 MCP 工具定义时，直接把真实路由信息绑定到 `execute` 闭包中；同时在 `tool-registry.ts` 侧不再依赖字符串解析 `serverName/toolName`。

也就是说，推荐取消当前这种依赖命名解析的路径：

```ts
parseMcpToolName(toolCall.function.name)
```

改为：
1. 在 `getRegisteredToolsForAgent()` 里拿到完整 `ToolDefinition[]`
2. 将 MCP tools 和 system tools 一样放入统一 `toolMap`
3. 当模型发起 tool call 时，直接从 `toolMap` 用安全别名查到对应 `ToolDefinition`
4. 调用其 `execute(args)`，由 `execute` 内部闭包直接调用：

```ts
mcpService.callTool({
  serverName,
  toolName,
  args,
})
```

这样可以彻底消除“通过名字反解 server/tool”的脆弱链路。

## 架构调整

### 受影响文件
- `e:\other-code\desktop-tools\src\main\mcp-service.ts`
  - 将 MCP tool 对外名称从 `mcp__{serverName}__{toolName}` 改为安全别名
  - 引入稳定别名生成逻辑
  - 保持 `execute` 闭包中仍使用真实 `serverName/toolName`

- `e:\other-code\desktop-tools\src\main\tool-registry.ts`
  - 移除/废弃基于正则的 `parseMcpToolName()`
  - 调整 MCP tool 执行分支，不再依赖别名字符串反解
  - 统一通过当前注册工具映射直接执行目标 tool

- `e:\other-code\desktop-tools\src\main\agent-service.ts`
  - 预期无需逻辑改动；仅复用调整后的工具注册输出

- `e:\other-code\desktop-tools\.comate\specs\mcp-agent-tooling/doc.md`
  - 不直接修改旧 spec 文件；本次修复作为独立增量 spec 管理

### 关键实现思路

#### 1. MCP tool 定义阶段直接绑定真实执行目标

```ts
tools.push({
  name: safeAlias,
  description: tool.description ? `[MCP/${serverName}] ${tool.description}` : `[MCP/${serverName}] ${tool.name}`,
  risk: 'low',
  strict: true,
  parameters: tool.inputSchema,
  validator: z.unknown(),
  source: {
    type: 'mcp',
    serverName,
  },
  execute: async (args) => {
    return this.callTool({
      serverName,
      toolName: tool.name,
      args,
    });
  },
});
```

#### 2. 工具注册中心统一按当前工具定义执行

对于安全别名后的 MCP tools，不再单独依赖名字解析，而是和系统工具一样，通过当前会话已注册的工具定义查表执行。

```ts
const tool = runtimeToolMap.get(toolCall.function.name);
if (!tool) {
  return buildErrorMessage(...);
}

const parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
const result = await tool.execute(parsedArgs, context);
```

#### 3. 继续保留来源区分

```ts
source: {
  type: 'mcp',
  serverName,
}
```

这样确认弹窗、审计日志、后续调试面板仍能识别该工具来自 MCP。

## 数据流
```text
当前 agent 绑定的 MCP servers
  -> mcp-service.ts 连接 server 并列出原始 tools
  -> 为每个原始 tool 生成安全 alias（如 mcp_0_1）
  -> tool-registry.ts 将 alias 作为 function.name 发送给模型
  -> 模型返回 tool_call(function.name = mcp_0_1)
  -> tool-registry.ts 从当前运行时注册工具表中找到该 alias 对应 ToolDefinition
  -> ToolDefinition.execute() 闭包内使用真实 serverName + toolName 调用 mcpService.callTool()
  -> 结果回填模型
```

## 边界条件与异常处理
1. server 名为中文、空格、特殊字符：不再影响工具注册。
2. tool 名为中文、空格、特殊字符：不再影响工具注册。
3. 不同 server 存在同名 tool：安全别名按位置生成，不冲突。
4. 同一 server 中多个 tool 名非法或相同：仍能通过不同 alias 区分。
5. 某次会话中启用 server 集合变化：重新构建工具列表时重新生成 alias。
6. 模型返回未知 alias：返回“未知工具”错误，不崩溃。
7. 工具展示可读性下降：通过 `description` 保留 `[MCP/{serverName}]` 与原始描述补偿。

## 风险与取舍
### 优点
- 修复最直接、最稳妥。
- 不要求迁移用户已有配置。
- 不依赖复杂字符转义与反解析。
- 彻底规避模型接口对工具名的正则限制。

### 代价
- MCP tool 名本身不再可读，调试时主要依赖 description 和日志。
- 若完全按“当前列表顺序”生成 alias，不同会话中 alias 可能变化。

### 取舍结论
优先保证兼容性和执行正确性。首版接受 alias 不可读；如果后续需要更高可读性，再考虑在安全前提下引入 slug + hash 组合，但本次不做过度设计。

## 验证方案
1. 配置中文 server 名，例如 `12306票务`。
2. 让该 server 返回至少一个 tool。
3. 发起会话，确认发送给模型的 `tools[].function.name` 不再包含中文或非法字符。
4. 触发 MCP tool call，确认能够正确执行到原始 server/tool。
5. 运行：
   - `npm run typecheck`
   - `npm run build`

## 预期结果
1. 即使 MCP server 名称或 tool 名称包含中文/特殊字符，也能正常注入工具。
2. 模型不会再因 `function.name` 非法而拒绝请求。
3. MCP 工具调用链路仍可正确命中真实 server/tool。
4. 现有 UI、配置文件和智能体绑定逻辑保持不变。