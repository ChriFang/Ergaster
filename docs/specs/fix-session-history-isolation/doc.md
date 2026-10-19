# 修复会话记录相互覆盖

## 背景
当前桌面应用支持“默认模式 + 多个智能体”切换，但聊天消息状态在主进程内只有一份全局内存数据。用户切换智能体后，界面上的当前智能体发生变化，底层会话消息却仍复用上一份历史，因此会出现“会话记录相互覆盖 / 串台”的现象。

## 需求场景与处理逻辑

### 场景 1：默认模式与某个智能体之间切换
- 用户先在“默认模式”发送多轮消息。
- 再切换到某个智能体继续提问。
- 期望：新智能体应看到自己的独立会话记录，不能继承默认模式的聊天上下文。
- 当前问题：`AgentService` 只有一份全局 `messages`，切换智能体只改变 system prompt，不改变会话消息容器，导致上下文串用。

### 场景 2：智能体 A 与智能体 B 之间切换
- 用户分别与 A、B 聊天，并来回切换。
- 期望：A 看到 A 的历史，B 看到 B 的历史；互不覆盖。
- 当前问题：A 和 B 共享同一份主进程消息数组，后一次对话会覆盖唯一活动会话状态。

### 场景 3：重置当前会话
- 用户在某个智能体下点击“重置会话”。
- 期望：仅重置当前模式/当前智能体对应的会话。
- 当前问题：重置会话会清空全局唯一会话，影响所有模式。

### 场景 4：页面初始加载与切换智能体后的消息展示
- 用户打开应用或切换当前智能体。
- 期望：前端应加载当前所选模式对应的消息列表。
- 当前问题：前端只在初次加载时调用一次 `getAgentMessages()`，后续切换智能体时不会按上下文拉取独立会话。

## 根因分析

### 根因 1：主进程会话状态是全局单例
文件：`e:\other-code\desktop-tools\src\main\agent-service.ts`
- `AgentService` 当前只维护：
  ```ts
  private messages: DeepSeekApiMessage[] = [];
  ```
- `run()` 基于 `this.messages` 继续累积消息：
  ```ts
  const workingMessages = [...this.messages, { role: 'user', content: prompt }];
  ```
- 当本轮完成后再整体写回：
  ```ts
  this.messages = workingMessages;
  ```

这意味着系统只有一个“当前会话”，并不存在“默认模式会话”“智能体 A 会话”“智能体 B 会话”的隔离存储。

### 根因 2：`agentId` 仅参与 system prompt 选择，不参与会话分桶
文件：`e:\other-code\desktop-tools\src\main\agent-service.ts`
- 当前逻辑：
  ```ts
  const requestMessages = selectedAgentContent
    ? [{ role: 'system', content: selectedAgentContent }, ...workingMessages]
    : workingMessages;
  ```
- `agentId` 只决定是否插入 system message，不决定读取/写入哪份消息历史。

### 根因 3：渲染层没有在智能体切换时同步加载对应会话
文件：`e:\other-code\desktop-tools\src\renderer\App.tsx`
- 初次加载时调用：
  ```ts
  void window.desktopApp.getAgentMessages().then(setMessages);
  ```
- 点击智能体时仅执行：
  ```ts
  setSelectedAgentId(agent.id)
  ```
- 没有：
  - 按当前上下文重新获取消息
  - 为不同上下文维护独立消息缓存
  - 将“重置会话”绑定到当前上下文

## 架构与技术方案

### 总体方案
将现有“全局唯一会话”改为“按会话键隔离的会话仓库”。

### 会话键设计
使用 `conversationKey` 表示当前会话上下文：
- 默认模式：`default`
- 智能体模式：`agent:{agentId}`

优点：
- 不引入新的复杂 sessionId 模型，修改面较小。
- 能直接解决当前“默认模式与各智能体互相覆盖”的问题。
- 前后端改动集中，适合当前项目结构。

### 主进程存储结构
将：
```ts
private messages: DeepSeekApiMessage[] = [];
```
改为类似：
```ts
private messagesByConversation = new Map<string, DeepSeekApiMessage[]>();
```

并增加一个统一的会话键解析逻辑，例如：
```ts
private getConversationKey(agentId?: string) {
  const normalized = agentId?.trim();
  return normalized ? `agent:${normalized}` : 'default';
}
```

### 运行逻辑
执行 `run(input)` 时：
1. 根据 `input.agentId` 计算 `conversationKey`
2. 从 `messagesByConversation` 中取当前会话历史
3. 基于该历史拼接本轮用户消息
4. 模型完成后仅写回当前 `conversationKey` 对应的消息数组
5. 返回当前上下文对应的消息列表

### 获取消息逻辑
为 `getMessages()` 增加可选输入上下文，按当前模式返回对应消息：
- 默认模式返回 `default`
- 智能体模式返回 `agent:{agentId}`

### 重置逻辑
为 `reset()` 增加可选输入上下文，仅清空当前会话键对应的消息。

### 前端联动
前端在以下时机调用“按当前智能体上下文获取消息”：
1. 页面初始化
2. 切换智能体
3. 运行失败后回读快照
4. 重置当前会话后刷新当前消息

## 受影响文件

### 1. 主进程会话服务
- 文件：`e:\other-code\desktop-tools\src\main\agent-service.ts`
- 修改类型：重构现有会话存储与读写逻辑
- 受影响函数：
  - `run(input: AgentRunInput)`
  - `reset()`
  - `getMessages()`
- 计划新增/调整：
  - 会话键解析函数
  - 按上下文读写消息 Map

### 2. 主进程 IPC 入口
- 文件：`e:\other-code\desktop-tools\src\main\index.ts`
- 修改类型：调整 IPC handler 入参透传
- 受影响 handler：
  - `agent:reset`
  - `agent:get-messages`
- 目的：允许前端按当前上下文请求消息或执行重置

### 3. 共享类型定义
- 文件：`e:\other-code\desktop-tools\src\shared\agent.ts`
- 修改类型：补充 `getMessages/reset` 所需输入类型，或扩展现有入参结构
- 目的：保证 preload、renderer、main 之间的类型一致

### 4. 预加载脚本
- 文件：`e:\other-code\desktop-tools\src\preload\index.ts`
- 修改类型：调整桥接 API 签名
- 受影响 API：
  - `resetAgent`
  - `getAgentMessages`

### 5. 渲染层主应用
- 文件：`e:\other-code\desktop-tools\src\renderer\App.tsx`
- 修改类型：修复切换智能体后的消息加载与重置逻辑
- 受影响逻辑：
  - 初始加载
  - 智能体切换按钮事件
  - `handleRunAgent`
  - `handleResetAgent`
  - 错误回读 `getAgentMessages`

## 实现细节

### 建议的数据结构
```ts
const DEFAULT_CONVERSATION_KEY = 'default';

class AgentService {
  private messagesByConversation = new Map<string, DeepSeekApiMessage[]>();

  private getConversationKey(agentId?: string) {
    const normalized = agentId?.trim();
    return normalized ? `agent:${normalized}` : DEFAULT_CONVERSATION_KEY;
  }
}
```

### 建议的消息读取方式
```ts
private getConversationMessages(agentId?: string) {
  const key = this.getConversationKey(agentId);
  return this.messagesByConversation.get(key) ?? [];
}
```

### 建议的消息写回方式
```ts
private setConversationMessages(agentId: string | undefined, messages: DeepSeekApiMessage[]) {
  const key = this.getConversationKey(agentId);
  this.messagesByConversation.set(key, messages);
}
```

### 建议的 IPC 载荷形式
可保持 `runAgent({ prompt, agentId? })` 不变；为读取/重置增加轻量参数对象：
```ts
getAgentMessages({ agentId?: string })
resetAgent({ agentId?: string })
```

### 前端切换智能体时的处理建议
```ts
async function switchAgent(nextAgentId: string | null) {
  setSelectedAgentId(nextAgentId);
  const snapshot = await window.desktopApp.getAgentMessages(nextAgentId ? { agentId: nextAgentId } : {});
  setMessages(snapshot);
  setLastError(null);
  setConfirmationRequest(null);
}
```

## 数据流

### 发送消息
1. `App.tsx` 读取 `selectedAgentId`
2. `runAgent({ prompt, agentId })` 发送到主进程
3. `agent-service.ts` 根据 `agentId` 解析 `conversationKey`
4. 读取该 key 的历史消息
5. 拼接用户消息、执行模型调用
6. 将结果写回同一 `conversationKey`
7. 返回该 key 对应的消息给渲染层

### 切换智能体
1. 用户点击智能体按钮
2. `App.tsx` 更新 `selectedAgentId`
3. 立即调用 `getAgentMessages({ agentId })`
4. 主进程返回该会话独立消息
5. UI 更新聊天区

### 重置会话
1. 用户点击“重置会话”
2. `App.tsx` 调用 `resetAgent({ agentId })`
3. 主进程仅清空对应 `conversationKey`
4. 前端清空当前聊天区

## 边界条件与异常处理

### 空 agentId
- `null`、`undefined`、空字符串都视为默认模式。
- 会统一映射到 `default` 会话键。

### 智能体被删除
- 如果当前选中的智能体被删除，前端已存在回退到默认模式的逻辑。
- 回退后需要同步加载默认模式会话，而不是继续展示旧消息。

### 运行失败
- 当前前端在失败时会调用 `getAgentMessages()` 回读快照。
- 修复后必须携带当前 `agentId`，避免失败后回读到其他上下文消息。

### 并发请求
- 当前 `AgentService` 已限制同一时刻只允许一个请求执行。
- 本次修复不改变该行为，只修复会话隔离。

### 消息持久化
- 本次先修复“相互覆盖”问题，不新增聊天消息落盘持久化。
- 应用重启后会话丢失仍是既有行为，不在本次范围内。

## 非目标
- 不改造输入记录 `chat-history` 的全局去重策略。
- 不引入多标签、多 session 历史管理。
- 不新增聊天记录磁盘持久化。
- 不修改智能体资料目录扫描机制。

## 预期结果
- 默认模式、智能体 A、智能体 B 之间的聊天记录彼此独立。
- 切换智能体时，聊天区展示对应会话内容，不再串台。
- 重置会话只影响当前模式，不影响其他模式。
- 发送失败后的消息回读与当前模式一致。

## 验证要点
1. 默认模式发送两轮消息，切到智能体 A，应看到空白或 A 自己的历史，而不是默认模式历史。
2. 在智能体 A、B 中分别发送不同内容，来回切换后各自历史保持独立。
3. 在智能体 A 中点击“重置会话”，A 清空，B 和默认模式不受影响。
4. 失败回读后，当前聊天区不应跳成其他智能体的历史。