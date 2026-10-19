# DeepSeek 模型结果流式显示改造设计

## 需求背景

当前桌面端在一次 Agent 请求完成后，才将完整消息批量回填到界面，用户无法看到模型逐步输出的内容。新需求是接入 DeepSeek Chat Completions 的流式返回能力，在模型生成过程中持续把增量内容显示到界面，并兼容 DeepSeek `reasoning_content` / `content` 双通道增量。

参考文档：用户提供的 DeepSeek Chat Completions 流式示例，要求使用 `stream: true`，并在流中分别累计：
- `chunk.choices[0].delta.reasoning_content`
- `chunk.choices[0].delta.content`

## 现状分析

### 当前调用链

1. Renderer 提交请求：`e:\other-code\desktop-tools\src\renderer\App.tsx:282`
2. Preload 暴露 IPC：`e:\other-code\desktop-tools\src\preload\index.ts:14`
3. Main 注册 `agent:run`：`e:\other-code\desktop-tools\src\main\index.ts:97`
4. AgentService 串行请求模型：`e:\other-code\desktop-tools\src\main\agent-service.ts:58`
5. DeepSeek 客户端一次性 `response.json()` 解析：`e:\other-code\desktop-tools\src\main\deepseek-client.ts:44`
6. Renderer 在 Promise 完成后整批 `setMessages(response.messages)`：`e:\other-code\desktop-tools\src\renderer\App.tsx:307`

### 当前限制

- `deepseek-client.ts` 未发送 `stream: true`
- 使用 `response.json()`，没有解析 SSE/流式分块
- Main 进程没有向 Renderer 推送增量事件
- Renderer 没有“占位中的 assistant 消息”与增量拼接逻辑
- `reasoning_content` 当前仅在 Main 内部保留，不会展示到 UI

## 目标行为

### 用户场景

#### 场景 1：普通文本流式输出
- 用户发送消息后，界面立即追加用户消息
- 界面进入“正在生成”状态
- assistant 消息以增量方式逐步显示 `content`
- 流结束后，assistant 消息固定为最终内容

#### 场景 2：推理模型返回 reasoning + content
- 若流中先返回 `reasoning_content`，需要持续累计
- 若随后返回 `content`，也需要持续累计
- UI 应优先保持当前消息正文可见，避免因为 reasoning 增加过多复杂交互
- `reasoning_content` 需要保存在会话消息中，以便下一轮请求原样传回 DeepSeek API

#### 场景 3：流式响应后触发 tool call
- 若模型流式阶段最终带有 `tool_calls`
- Main 进程在流结束后继续沿用现有工具调用回合逻辑
- Renderer 在流式展示完当前 assistant 消息后，再等待工具执行结束并同步最终消息快照

#### 场景 4：取消执行
- 用户点击取消时，中断当前 fetch 流
- Main 停止继续消费流
- Renderer 停止显示“正在生成”，保留当前已接收的部分内容
- 如 Main 已有会话快照，则前端以快照为准恢复

## 技术方案

## 总体方案

保留现有 `runAgent` 请求-响应模型用于最终结果返回，同时新增一条 Main -> Renderer 的流式事件通道：

1. Renderer 发起 `runAgent`
2. Main 使用 DeepSeek 流式接口读取 SSE
3. 每收到一个 delta，Main 通过 IPC 事件推送流式片段
4. Renderer 维护“流式中的 assistant 消息”并增量更新
5. 流结束后，`runAgent` Promise 返回最终消息列表，覆盖本地临时状态，确保与服务端会话一致

这样改动范围最小：
- 不必推翻现有 `runAgent` / tool-call 主流程
- 工具调用、审计日志、取消逻辑仍由 `AgentService` 控制
- Renderer 只增加流式事件订阅和本地临时消息拼接

## 数据结构设计

### 新增流式事件类型

修改 `e:\other-code\desktop-tools\src\shared\agent.ts`，增加流式事件定义：

```ts
export type AgentStreamEvent = {
  agentId?: string;
  deltaReasoningContent?: string;
  deltaContent?: string;
  done?: boolean;
};
```

说明：
- `agentId` 用于区分不同 agent 会话
- `deltaReasoningContent` 表示本次 chunk 的 reasoning 增量
- `deltaContent` 表示本次 chunk 的正文增量
- `done` 用于标记本轮模型流已结束

如需前端展示 reasoning，可同步扩展 `AgentMessage`：

```ts
export type AgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  reasoning_content?: string;
  tool_call_id?: string;
  name?: string;
};
```

### DeepSeek 流式 chunk 结构

修改 `e:\other-code\desktop-tools\src\main\deepseek-client.ts`，新增用于解析 SSE 的类型：

```ts
type ChatCompletionStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
};
```

## 详细实现

### DeepSeek 客户端改造

**文件**：`e:\other-code\desktop-tools\src\main\deepseek-client.ts`

#### 改造点 1：新增流式接口
保留现有一次性接口的函数签名风格，但新增流式版本，例如：

```ts
export async function createChatCompletionStream(options: {
  config: AppConfig;
  messages: DeepSeekApiMessage[];
  tools: DeepSeekTool[];
  signal: AbortSignal;
  onChunk: (event: {
    deltaContent?: string;
    deltaReasoningContent?: string;
  }) => void;
})
```

#### 改造点 2：请求体启用 `stream: true`

```ts
body: JSON.stringify({
  model: config.model,
  messages,
  tools,
  stream: true,
  extra_body: {
    thinking: {
      type: config.thinkingModeEnabled ? 'enabled' : 'disabled',
    },
  },
})
```

#### 改造点 3：解析 SSE 流
使用 `response.body.getReader()` + `TextDecoder` 读取文本流，按行解析 `data:` 前缀。伪代码：

```ts
const reader = response.body?.getReader();
const decoder = new TextDecoder();
let buffer = '';
let content = '';
let reasoningContent = '';
let toolCalls: ToolCall[] = [];

while (true) {
  const { value, done } = await reader.read();
  if (done) {
    break;
  }

  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split('\n\n');
  buffer = frames.pop() ?? '';

  for (const frame of frames) {
    for (const line of frame.split('\n')) {
      const normalized = line.trim();
      if (!normalized.startsWith('data:')) {
        continue;
      }

      const raw = normalized.slice(5).trim();
      if (raw === '[DONE]') {
        continue;
      }

      const chunk = JSON.parse(raw) as ChatCompletionStreamChunk;
      const delta = chunk.choices?.[0]?.delta;

      if (delta?.reasoning_content) {
        reasoningContent += delta.reasoning_content;
        onChunk({ deltaReasoningContent: delta.reasoning_content });
      }

      if (delta?.content) {
        content += delta.content;
        onChunk({ deltaContent: delta.content });
      }

      if (delta?.tool_calls?.length) {
        toolCalls = mergeToolCalls(toolCalls, delta.tool_calls);
      }
    }
  }
}
```

#### 改造点 4：合并 tool call 增量
流式工具调用可能分多块返回，需要按 index / id / function 字段聚合。建议在 `deepseek-client.ts` 内实现局部辅助函数，将分块的 `tool_calls` 聚合成完整 `ToolCall[]`。如当前模型尚未在本项目里依赖流式 tool call，也必须兼容，否则会破坏既有能力。

#### 改造点 5：返回最终 assistant message
最终仍返回统一结构：

```ts
return {
  role: 'assistant' as const,
  content: content || null,
  ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
  ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
};
```

### AgentService 改造

**文件**：`e:\other-code\desktop-tools\src\main\agent-service.ts`

#### 改造点 1：在模型调用时转发流式事件
将当前：

```ts
const assistantMessage = await createChatCompletion(...)
```

改为调用流式版本，并在回调中把 chunk 推送给窗口：

```ts
const assistantMessage = await createChatCompletionStream({
  config,
  messages: requestMessages,
  tools,
  signal: abortController.signal,
  onChunk: (event) => {
    this.emitStreamEvent({
      agentId,
      deltaContent: event.deltaContent,
      deltaReasoningContent: event.deltaReasoningContent,
    });
  },
});
```

#### 改造点 2：提供事件分发能力
`AgentService` 目前只返回 Promise，没有事件出口。需要增加订阅/转发能力。推荐不要让 `AgentService` 直接依赖 `BrowserWindow`，而是在 Main 层使用轻量回调注册，例如：

```ts
type AgentStreamListener = (event: AgentStreamEvent) => void;

private streamListeners = new Set<AgentStreamListener>();

onStream(listener: AgentStreamListener) {
  this.streamListeners.add(listener);
  return () => this.streamListeners.delete(listener);
}
```

内部统一调用：

```ts
private emitStreamEvent(event: AgentStreamEvent) {
  for (const listener of this.streamListeners) {
    listener(event);
  }
}
```

#### 改造点 3：流结束发完成事件
当本轮模型流结束且拿到完整 assistant message 后，发送：

```ts
this.emitStreamEvent({ agentId, done: true });
```

注意：
- 只表示“本轮模型输出结束”
- 不表示整个 `runAgent` 已结束，因为后面可能还有工具调用轮次
- 最终仍以 `runAgent` 返回值作为会话真值

### Main IPC / Preload 改造

**文件**：
- `e:\other-code\desktop-tools\src\main\index.ts`
- `e:\other-code\desktop-tools\src\preload\index.ts`
- `e:\other-code\desktop-tools\src\shared\contracts.ts`

#### 改造点 1：Main 转发到 Renderer
在 `index.ts` 中注册 `agentService.onStream(...)`，拿到事件后通过 `mainWindow.webContents.send('agent:stream', payload)` 广播到渲染进程。

#### 改造点 2：Preload 暴露订阅 API
在 `DesktopAppApi` 中新增：

```ts
onAgentStream: (listener: (event: AgentStreamEvent) => void) => () => void;
```

在 `preload/index.ts` 中桥接：

```ts
onAgentStream: (listener) => {
  const handler = (_event: unknown, payload: AgentStreamEvent) => listener(payload);
  ipcRenderer.on('agent:stream', handler);
  return () => ipcRenderer.removeListener('agent:stream', handler);
},
```

### Renderer 改造

**文件**：`e:\other-code\desktop-tools\src\renderer\App.tsx`

#### 改造点 1：订阅流式事件
组件初始化时通过 `window.desktopApp.onAgentStream(...)` 订阅事件，并在卸载时取消订阅。

#### 改造点 2：维护流式中的 assistant 临时消息
当前提交后只追加用户消息：`e:\other-code\desktop-tools\src\renderer\App.tsx:304`

需要在开始运行后，允许插入一个临时 assistant 消息并不断追加内容。推荐策略：
- 用户发起请求时只先追加 user 消息
- 首次收到流式 delta 时，如果末尾不是当前轮次的 assistant 临时消息，则追加一条 `{ role: 'assistant', content: '', reasoning_content: '' }`
- 后续 chunk 到来时，拼接到最后一条 assistant 消息

示例逻辑：

```ts
setMessages((current) => {
  const next = [...current];
  const last = next.at(-1);
  if (!last || last.role !== 'assistant') {
    next.push({ role: 'assistant', content: '', reasoning_content: '' });
  }

  const assistant = next[next.length - 1];
  assistant.content += event.deltaContent ?? '';
  assistant.reasoning_content = (assistant.reasoning_content ?? '') + (event.deltaReasoningContent ?? '');
  return [...next];
});
```

#### 改造点 3：最终结果覆盖临时消息
保留现有逻辑：

```ts
const response = await window.desktopApp.runAgent(...);
setMessages(response.messages);
```

这样可确保：
- 临时流式内容仅用于过程展示
- 最终以 Main 会话状态为准
- 工具调用后的消息也能一次性同步完整

#### 改造点 4：运行状态文案
收到流式片段时，可将 `runStatus` 从“Agent 正在执行...”更新为“模型正在生成回复...”。最终仍按原逻辑在 Promise 完成后改为“已收到模型回复。”或“已完成工具调用。”

### 消息渲染改造

**文件**：
- `e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts`
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`
- 视需要补充样式文件

#### 展示策略
为了控制改动范围，本次优先方案为：
- assistant 主体仍展示 `content`
- `reasoning_content` 先不单独渲染为新卡片
- 但要在 `AgentMessage` / 会话状态中保留，保证下一轮请求可回传

可选增强（不作为本次必选）：
- assistant 消息上方加“思考中”折叠区域展示 reasoning
- 流式时先展示 reasoning，再展示 final answer

本次建议不引入该增强，以避免 UI 结构扩散到多处组件。

## 受影响文件

| 文件 | 修改类型 | 主要改动 |
|---|---|---|
| `e:\other-code\desktop-tools\src\main\deepseek-client.ts` | 修改 | 增加 `stream: true` 请求、SSE 解析、tool call 聚合、流式回调 |
| `e:\other-code\desktop-tools\src\main\agent-service.ts` | 修改 | 调用流式接口、分发增量事件、保持最终消息入库 |
| `e:\other-code\desktop-tools\src\main\index.ts` | 修改 | 将 AgentService 流式事件转发为 `agent:stream` IPC |
| `e:\other-code\desktop-tools\src\preload\index.ts` | 修改 | 暴露 `onAgentStream` 订阅 API |
| `e:\other-code\desktop-tools\src\shared\contracts.ts` | 修改 | 为 preload / renderer 添加流式订阅类型 |
| `e:\other-code\desktop-tools\src\shared\agent.ts` | 修改 | 增加 `AgentStreamEvent`，必要时扩展 `AgentMessage.reasoning_content` |
| `e:\other-code\desktop-tools\src\renderer\App.tsx` | 修改 | 订阅流式事件、维护临时 assistant 消息、最终覆盖快照 |
| `e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts` | 可能修改 | 若保留 reasoning_content 到前端类型，需要兼容正文模型 |

## 数据流路径

### 正常流式路径

```text
用户提交 prompt
-> Renderer 调用 window.desktopApp.runAgent
-> Main AgentService 开始 run
-> deepseek-client 发送 stream=true 请求
-> DeepSeek 持续返回 SSE chunk
-> deepseek-client 解析 delta
-> AgentService 发出 AgentStreamEvent
-> main/index.ts 通过 IPC 推送 agent:stream
-> preload 转发给 Renderer
-> App.tsx 增量拼接 assistant 临时消息
-> 流结束后 AgentService 写入完整 assistant message
-> 若有工具调用则继续工具回合
-> runAgent Promise 返回最终 messages
-> Renderer setMessages(response.messages)
```

### 多轮会话路径

```text
上一轮 assistant message 含 reasoning_content
-> 保存在 Main conversation messages
-> 下一轮请求时 requestMessages 原样带上 reasoning_content
-> DeepSeek thinking mode 正常工作
```

## 边界条件与异常处理

### SSE 响应异常
- `response.ok === false` 时仍按现有错误处理返回 API 报错信息
- `response.body` 为空时抛出明确错误，例如“DeepSeek 未返回可读取的流”
- 无法解析的非 JSON 行应跳过空行，但对真正的非法 payload 抛错，便于定位接口兼容问题

### 分块边界
- 一个 JSON 片段可能跨多个 TCP chunk，需要 buffer 累积后按 `\n\n` 切帧
- 同一个 `tool_call.arguments` 可能被拆成多段，必须拼接

### 空增量
- 某些 chunk 只带 `reasoning_content`
- 某些 chunk 只带 `content`
- 某些 chunk 只带 `tool_calls`
- 不应因字段缺失报错

### UI 一致性
- 如果流中已显示部分 assistant 文本，但最终 `runAgent` 失败，前端应回退到 `getAgentMessages(...)` 快照
- 如果取消请求，保留当前已展示的局部内容即可，最终快照为空时至少保留用户消息

### 并发限制
- 当前 `AgentService` 已限制一次只能有一个活动请求：`e:\other-code\desktop-tools\src\main\agent-service.ts:58`
- 本次无需扩展并发模型，但流式事件仍建议携带 `agentId`，避免后续演进时接口再次变更

### 性能与安全
- 流式更新频率高于整包刷新，但当前桌面应用单会话规模可接受
- 不新增外部 URL 拼接逻辑，不改变鉴权方式
- 继续复用现有 `AbortController` 取消机制，避免悬挂请求

## 预期结果

- 用户发送消息后，模型回复能逐字/逐段流式显示
- DeepSeek thinking 模式下的 `reasoning_content` 能在 Main 会话中完整保留并用于下一轮请求
- 现有工具调用回合逻辑保持可用
- 取消请求、异常回退、最终消息一致性保持稳定
- 构建与类型检查通过
