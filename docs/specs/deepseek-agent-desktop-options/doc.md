# DeepSeek Agent 桌面工具 Electron 方案设计

## 需求场景
用户希望基于 DeepSeek 模型实现一套 Agent 工具，用于快速执行日常 Windows 电脑操作。最终产物是一个 Windows 桌面应用程序，交互形态类似 chatbot：用户输入自然语言命令，LLM 根据可用工具决定是否调用用户自定义 tools，并由本地程序执行真实操作。

根据最新要求，技术路线只保留 Electron + TypeScript + Node.js 方案，不再展开 .NET 或 Tauri 方案。

## 已知上下文
- 当前仓库：`e:\other-code\desktop-tools`
- 当前仓库仅包含基础 README，尚未形成应用代码结构。
- 目标平台：Windows 桌面应用。
- 选定技术栈：Electron + TypeScript + Node.js。
- DeepSeek Tool Calls 机制参考：`https://api-docs.deepseek.com/zh-cn/guides/tool_calls`

## DeepSeek Tool Calls 核心机制
DeepSeek 的工具调用与 OpenAI Chat Completions 风格接近：

1. 客户端向 DeepSeek Chat Completion API 发送：
    - `model`
    - `messages`
    - `tools`
2. `tools` 中声明可调用函数：
    - `type: "function"`
    - `function.name`
    - `function.description`
    - `function.parameters`，使用 JSON Schema 描述参数
3. 模型返回 `tool_calls` 时，客户端需要：
    - 解析工具名和参数
    - 在本地执行对应工具函数
    - 将执行结果以 `role: "tool"`、`tool_call_id`、`content` 追加回 messages
4. 再次请求模型，由模型基于工具结果生成最终回复或继续调用工具。
5. 工具本身需要应用开发者实现，模型不会执行真实函数。
6. 建议使用 `strict: true` 让模型更严格遵循 JSON Schema。桌面操作需要更可靠的参数结构，避免模型生成额外字段或模糊参数。

## Electron 总体架构

```text
用户输入
  -> Renderer Chat UI
  -> Preload IPC Bridge
  -> Main Process Agent Orchestrator
  -> DeepSeek Chat Completion API
  -> Tool Call Parser
  -> Tool Registry
  -> Permission / Confirmation Guard
  -> Node.js / PowerShell Windows Tool Executor
  -> Tool Result
  -> DeepSeek 二次推理
  -> Renderer 展示最终回复
```

### 模块职责
- Renderer Chat UI：展示对话、工具调用状态、执行结果、失败原因；只负责 UI，不直接访问 Node.js 能力。
- Preload IPC Bridge：通过 `contextBridge` 暴露最小化、受控的 IPC API。
- Main Process Agent Orchestrator：维护 messages、调用 DeepSeek、处理多轮 tool calls、协调工具执行。
- Tool Registry：注册用户自定义工具，生成 DeepSeek tools schema，并将 tool name 映射到本地执行函数。
- Tool Call Parser：解析模型返回的 tool calls，校验工具名、参数 JSON 和调用数量。
- Permission Guard：对中高风险操作二次确认，例如删除文件、执行 shell、修改系统设置、联网请求、批量操作。
- Windows Tool Executor：用 Node.js、PowerShell、Win32 CLI 或第三方 npm 包执行真实 Windows 操作。
- Audit Log：记录用户命令、模型工具调用、工具参数、执行结果和失败原因，便于排查误操作。

## 技术路线
使用 Electron 构建 Windows 桌面应用：
- Renderer：推荐 React + TypeScript 实现 chatbot UI。
- Main Process：实现 Agent Orchestrator、DeepSeek API 调用、工具调度、安全确认和审计日志。
- Config：通过本地配置文件保存 DeepSeek API Key、模型名、API Base URL 等可配置项，支持用户在设置界面查看、修改和保存。
- Preload：通过受控 IPC 暴露 `sendMessage`、`confirmToolCall`、`cancelRun`、`getConfig`、`saveConfig` 等有限能力。
- Tools：用 TypeScript/Node.js 实现，必要时调用 PowerShell、Windows CLI、Node 原生能力或第三方库。
- Packaging：后续可使用 electron-builder 或 Electron Forge 打包 Windows 安装包。

## 核心处理逻辑
1. Renderer 收集用户输入并通过 IPC 发送给 Main Process。
2. Main Process 将用户消息追加到当前会话 messages。
3. Agent Orchestrator 调 DeepSeek API，携带由 Tool Registry 生成的 `tools`。
4. 如果模型返回普通 assistant 内容，直接回传 UI 展示。
5. 如果模型返回 `tool_calls`：
    - 校验工具名是否在白名单中。
    - 使用 JSON Schema / Zod 校验参数。
    - 根据工具风险级别决定是否弹窗确认。
    - 执行工具并捕获 stdout、stderr、错误和超时。
    - 将执行结果追加为 `role: "tool"` 消息。
6. Agent Orchestrator 再次调用 DeepSeek，让模型基于工具结果生成最终回复或继续调用工具。
7. 设置最大工具调用轮数，避免无限循环。

## Tool Definition 设计
建议用 TypeScript 定义统一工具接口：

```ts
type ToolRisk = "low" | "medium" | "high";

type ToolResult = {
  ok: boolean;
  content: string;
  data?: unknown;
  error?: string;
};

type ToolContext = {
  signal: AbortSignal;
  workingDirectory?: string;
  requestUserConfirmation: (message: string) => Promise<boolean>;
};

type ToolDefinition<TArgs> = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  strict: true;
  risk: ToolRisk;
  execute: (args: TArgs, ctx: ToolContext) => Promise<ToolResult>;
};
```

Tool Registry 负责把 `ToolDefinition` 转换为 DeepSeek API 所需的 `tools`：

```ts
const deepseekTools = registeredTools.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: tool.strict,
  },
}));
```

## MVP 工具范围
第一版建议只实现低风险和可控风险工具，避免直接开放任意命令执行：

- `open_application`：打开白名单应用，例如记事本、计算器、浏览器。
- `open_path`：打开指定文件或文件夹，但限制在允许目录范围内。
- `get_system_info`：获取系统版本、CPU、内存、当前用户名等只读信息。
- `search_files`：在固定目录下搜索文件。
- `write_clipboard`：写入剪贴板。
- `create_text_draft`：在指定安全目录创建文本草稿。
- `run_powershell_template`：仅允许执行预定义 PowerShell 模板，且执行前必须确认。

## 安全边界与异常处理
- 所有 tools 必须通过白名单注册，不允许模型自由拼接函数名。
- 使用 `strict: true` 和 `additionalProperties: false` 降低参数漂移。
- 使用 Zod 或 AJV 在本地再次校验工具参数，不能只依赖模型遵循 schema。
- 高风险操作必须要求用户确认。
- Renderer 禁止开启 Node integration，使用 `contextIsolation: true`。
- IPC 只暴露最小 API，不暴露通用 shell、文件系统或 eval 能力。
- 文件操作必须限制可访问目录，避免任意路径读写。
- Shell 执行必须分级授权，默认禁用任意命令，只允许模板化命令。
- API Key 应存储在 Windows Credential Manager、DPAPI 或安全配置中，不应硬编码。
- 工具执行必须设置超时、取消和错误返回。
- 工具执行前后记录审计日志，包括工具名、参数摘要、结果状态和错误信息。

## Electron 方案优点
- 生态成熟，开发桌面 chatbot 体验较好。
- TypeScript 适合描述 tools schema、参数类型、执行结果类型。
- Node.js 对文件、进程、网络、剪贴板、脚本调用支持方便。
- 前端 UI 开发效率高，可快速做出类似 ChatGPT 的交互体验。
- 与 DeepSeek 的 HTTP API 对接直接，工具调用循环容易实现。
- 自定义 tools 可以直接作为 npm 包、插件或本地 TS 模块扩展。
- React/Vue 等前端生态可复用大量聊天 UI、状态管理和 Markdown 渲染能力。

## Electron 方案缺点
- Electron 体积和内存占用较高。
- 需要严格隔离 Renderer 和 Main Process，否则桌面自动化工具存在安全风险。
- 部分 Windows 深度能力仍需借助 PowerShell、原生插件或外部程序。
- 打包、自动更新、代码签名需要额外配置。
- 如果允许自定义工具插件，需要额外设计插件加载、签名校验和权限声明。

## 推荐结论
当前需求应采用 Electron + TypeScript + Node.js 作为唯一实现路线。

原因：
- DeepSeek tool calls 的本质是 JSON Schema + HTTP + 本地函数映射，TypeScript 实现成本较低。
- chatbot UI 可以快速迭代。
- 用户自定义 tools 可以用 TS 模块化注册，开发体验好。
- 对日常电脑操作来说，Node.js + PowerShell 已能覆盖大部分场景。
- 相比先做多技术路线评估，直接聚焦 Electron 更利于进入 MVP 实现。

## 预期产出
确认后可进入实际实现任务：
- 初始化 Electron + TypeScript 工程。
- 实现 DeepSeek Agent 调用循环。
- 实现 Tool Registry 和工具参数校验。
- 实现权限确认和审计日志。
- 实现第一批 Windows tools。
- 实现 chatbot UI。