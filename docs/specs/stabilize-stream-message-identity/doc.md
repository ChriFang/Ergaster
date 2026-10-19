# 稳定流式消息身份以消除重影渲染

## 背景
当前 DeepSeek 流式回复已经支持 `reasoning_content` 与 `content` 的增量展示，也已经完成了同 chunk 事件合并与 `content_started` 提前标记。但用户截图仍显示同一段中文文本在同一区域出现白色重影/叠画感，现象更接近同一条消息节点被重复复用与覆盖，而不是两个独立气泡简单同时存在。

## 问题场景与处理逻辑
### 场景 1：单轮流式回复从 reasoning 切换到正文
- 现状：renderer 在收到流式事件时，仅根据“最后一条消息是否为 assistant”决定是否复用现有消息。
- 风险：当同一条 assistant 消息的展示形态从 reasoning 临时气泡切换到正文气泡时，React 会继续复用同一个索引位置的节点；若最终 `runAgent` 返回的完整消息快照又覆盖到相同 index，视觉上容易表现为文本在同一区域被再次绘制。
- 目标：每次流式 assistant 回复都应有稳定身份，流式增量更新与最终快照落盘要能对齐到同一逻辑消息，而不是只依赖数组末尾角色判断。

### 场景 2：多轮 tool call 后再次进入 assistant 流式回复
- 现状：主进程按轮次生成 assistant message，但发给 renderer 的 `AgentStreamEvent` 不包含某个可区分本轮 assistant 的稳定标识。
- 风险：renderer 只能继续把后续 delta 拼到最后一条 assistant，无法区分“上轮 assistant 的最终消息”和“本轮新的 assistant 流消息”，一旦相邻轮次文本相近，就会产生叠画观感。
- 目标：主进程在每轮 assistant 流启动时生成流式消息 id，并在整个流生命周期内随事件下发；renderer 必须按该 id 精确更新消息。

### 场景 3：流式临时消息与最终消息快照替换
- 现状：`runAgent` 完成后，renderer 会直接 `setMessages(response.messages)` 整体替换消息列表；而 `getMessageKey` 主要基于 `role + index`，assistant 无稳定 key。
- 风险：React 可能复用旧 DOM 节点承接新消息对象，流式中间态和最终态在视觉上粘连，造成类似重影的结果。
- 目标：共享消息类型中补充稳定消息 id，流式态与最终态使用同一 id，使 `MessageList` key 与状态更新目标保持一致。

## 架构与技术方案

### 共享类型扩展
在 `src/shared/agent.ts` 中为 `AgentMessage` 和 `AgentStreamEvent` 增加稳定身份字段：
- `id?: string`：对外暴露给 renderer 的消息唯一标识。
- `streamMessageId?: string`：标识当前流式 assistant 目标消息。

建议结构：
```ts
export type AgentMessage = {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  reasoning_content?: string;
  content_started?: boolean;
  tool_call_id?: string;
  name?: string;
};

export type AgentStreamEvent = {
  agentId?: string;
  streamMessageId?: string;
  deltaReasoningContent?: string;
  deltaContent?: string;
  done?: boolean;
};
```

### 主进程消息建模
在 `src/main/agent-service.ts` 中：
1. 为本次用户输入创建稳定的 user message id。
2. 每轮 assistant 流式开始前生成一个新的 assistant message id，例如 `assistant-${Date.now()}-${round}` 或更稳妥的随机 id。
3. `onChunk` 发出的每个 `AgentStreamEvent` 都携带 `streamMessageId`。
4. 流结束后，将最终 assistantMessage 写入 `workingMessages` 时也附带同一个 id。
5. `toPublicMessages(...)` 需要把内部消息 id 透传为 `AgentMessage.id`。

为了尽量减少改动范围，可在主进程内部为 `DeepSeekApiMessage` 的实际存储对象附加 `id` 字段，并在转换为 public message 时保留；不需要重构整个 DeepSeek client。

### Renderer 流式累积策略
在 `src/renderer/App.tsx` 中重写 `appendAssistantStreamDelta(...)`：
1. 不再通过“最后一条是否是 assistant”判断目标消息。
2. 优先使用 `event.streamMessageId` 查找当前消息列表中的 assistant 消息。
3. 若不存在，则创建一条带该 `id` 的临时 assistant 消息。
4. 后续 delta 全部按同一 id 累加。
5. 若事件缺少 `streamMessageId`，则直接忽略，避免错误拼接到错误消息。

建议核心逻辑：
```ts
function appendAssistantStreamDelta(currentMessages: AgentMessage[], event: AgentStreamEvent) {
  if (!event.streamMessageId) {
    return currentMessages;
  }

  const nextMessages = [...currentMessages];
  let targetIndex = nextMessages.findIndex((message) => message.id === event.streamMessageId);

  if (targetIndex === -1) {
    nextMessages.push({
      id: event.streamMessageId,
      role: 'assistant',
      content: '',
      reasoning_content: '',
      content_started: false,
    });
    targetIndex = nextMessages.length - 1;
  }

  const assistantMessage = nextMessages[targetIndex];
  if (assistantMessage.role !== 'assistant') {
    return currentMessages;
  }

  assistantMessage.content += event.deltaContent ?? '';
  if (event.deltaContent !== undefined) {
    assistantMessage.content_started = true;
  }
  assistantMessage.reasoning_content = `${assistantMessage.reasoning_content ?? ''}${event.deltaReasoningContent ?? ''}`;

  return [...nextMessages];
}
```

### MessageList key 稳定化
在 `src/renderer/features/messages/message-model.ts` 中：
- 优先使用 `message.id` 作为 React key。
- 仅在旧数据没有 id 时再回退到现有索引逻辑。

建议：
```ts
export function getMessageKey(message: AgentMessage, index: number) {
  return message.id ?? `${message.role}-${index}-${message.tool_call_id ?? 'message'}`;
}
```

这样可避免流式临时消息与最终快照替换时复用错误节点。

## 受影响文件

### 1. `e:\other-code\desktop-tools\src\shared\agent.ts`
- 修改类型定义
- 影响函数/结构：`AgentMessage`、`AgentStreamEvent`

### 2. `e:\other-code\desktop-tools\src\main\agent-service.ts`
- 修改主进程消息生成与 stream 事件下发
- 影响函数：`toPublicMessages(...)`、`run(...)`
- 新增内容：消息 id 生成、assistant streamMessageId 透传

### 3. `e:\other-code\desktop-tools\src\renderer\App.tsx`
- 修改流式消息累加策略
- 影响函数：`appendAssistantStreamDelta(...)`、`handleRunAgent(...)` 附近的消息初始化与事件消费逻辑

### 4. `e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts`
- 修改 `getMessageKey(...)`

## 数据流路径
1. 用户在 renderer 发起 `runAgent`
2. main `agent-service.ts` 为本轮 assistant 生成稳定消息 id
3. deepseek stream chunk -> `agent-service.ts` `emitStreamEvent({ streamMessageId, ... })`
4. preload 原样转发
5. renderer `onAgentStream` 按 `streamMessageId` 命中或创建目标 assistant 消息
6. `MessageList` 以 `message.id` 作为 key 渲染
7. `runAgent` 完成后返回的 `response.messages` 中包含同一 `id`，最终态与流式态保持身份一致

## 边界条件与异常处理
- 若 `streamMessageId` 缺失，renderer 不应退回“最后一条 assistant”模式，避免错误累加。
- 若切换 agent 会话，现有 `agentId` 过滤逻辑继续保留，防止不同 agent 的流事件串线。
- 若请求取消，临时消息可以保留当前已生成文本，由后续 snapshot 或 reset 清理；本次改动不额外引入清理策略。
- 若旧历史消息没有 `id`，`getMessageKey` 仍可回退旧逻辑，不影响已存会话显示。

## 预期结果
- reasoning 切换到正文时，不再出现同一区域白色重影/叠字感。
- 多轮 assistant/tool/assistant 场景下，新的 assistant 流不会误拼到上一个 assistant 消息。
- 流式临时消息与最终完整消息快照在 React 层共享稳定 key，减少错误节点复用。
- `npm run typecheck` 与 `npm run build` 应继续通过。
