# 多会话独立视图（session-independent-view）

## 一、需求背景与目标

当前渲染层所有会话**共用一份状态**（`useChatSession` 唯一一份 `messages/isRunning/filePreviews/cursor`），切换会话靠"清空 + 从磁盘重载"实现。由此产生：切换有重载开销、后台会话无法实时渲染、切走正在生成的会话看不到进度。

目标（**Scope 1：仅渲染层会话隔离，后端仍单实例执行**）：

1. **切换即时**：会话间切换不再清空重载，直接展示目标会话已在内存的视图
2. **后台实时渲染**：A 会话生成中切到 B，A 的流式内容仍持续写入 A 的内存视图；切回 A 看到的是"活的"最新进度而非重载快照
3. 每个会话相当于一个独立"标签"的运行时视图（**不新增多标签页 UI**，沿用现有下拉列表切换）

### 明确的范围边界（务必对齐）

| 项 | 结论 |
|---|---|
| 后台**查看**其他会话 | ✅ 支持 |
| 后台**发起**第二个会话的请求（并发生成） | ❌ 不支持。后端 `agentService` 单例，`abortController` 占用期拒绝新请求（agent-service.ts:472）。属于 Scope 2，本次不做 |
| 多标签页 UI | ❌ 不做，沿用会话下拉列表 |
| 删除正在后台运行的会话 | ❌ **禁止**，必须等其执行结束才能删除（本次新增硬约束，见 §5） |

## 二、现状分析

- `useChatSession`（use-chat-session.ts:64-104）持有唯一一份每会话相关状态：`messages`、`messagesPageCursor`、`hasMoreMessagesBefore`、`isRunning`、`runStatus`、`lastError`、`confirmationRequest`、`filePreviews`、`expandedToolMessageKeys`，以及流缓冲 `pendingStreamEventsRef`/`streamFlushTimerRef`
- `switchConversationScope`（:242-267）/ `handleSelectConversation`：切换 = `setMessages([]) → loadConversationMessages(目标)` 从磁盘重载
- `applyStreamDelta`（:处理流事件）：非活动会话的事件按 `matchesStreamEventConversation` **直接丢弃**
- 流事件已带 `conversationId`（commit 6c32bf0），主进程 `agentService` 单例执行、`cancel()` 作用于唯一 `abortController`
- 删除会话 `handleDeleteConversation`：当前仅在 `isRunning && 删除的是激活会话` 时拦截，**未覆盖"删除后台正在跑的会话"**

## 三、技术方案

### 3.1 核心：单份状态 → 按 conversationId 分桶

新增会话状态桶（renderer 内存）：

```ts
type SessionState = {
  messages: AgentMessage[];
  messagesPageCursor: ConversationMessageCursor | null;
  hasMoreMessagesBefore: boolean;
  isRunning: boolean;
  runStatus: string;
  lastError: string | null;
  confirmationRequest: ToolConfirmationRequest | null;
  filePreviews: FilePreviewItem[];
  expandedToolMessageKeys: Record<string, boolean>;
  pendingStreamEvents: AgentStreamEvent[]; // 流缓冲按会话隔离
};
// 存储：Map<conversationId, SessionState>，用一个 version 计数或 useReducer 触发渲染
```

**保持 hook 返回面不变**（关键，最小化外部改动）：对外仍暴露 `messages/isRunning/...`，内部从"活动桶"派生：

```ts
const active = getSession(activeConversationId);
return { messages: active.messages, isRunning: active.isRunning, /* ... */ };
```

App.tsx / ConsolePanel / ChatConsoleView / MessageList / Composer 消费活动切片，**基本不改**。

**全局状态保持单份**（不进桶）：`agents / skills / selectedAgentId / selectedCodeProjectId / activeConversationId / conversationList`。

### 3.2 流事件从"丢弃"改为"路由"

`applyStreamDelta` 逻辑反转：不再因非活动就 return，而是按 `event.conversationId` 写入对应桶（后台会话照常累积）。流缓冲的合并刷新（`STREAM_FLUSH_INTERVAL_MS`）改为按会话维护 timer/buffer，避免后台与前台 delta 混流。

```ts
// 现状：if (!matchesStreamEventConversation(event, activeConversationIdRef.current)) return;
// 改为：路由到 event.conversationId 对应的桶
routeStreamEvent(event.conversationId, event);
```

### 3.3 切换会话：命中桶则复用，未命中才重载

`handleSelectConversation`：目标会话已有桶 → 直接切 `activeConversationId`（即时，无重载）；无桶（首次进入/被 LRU 淘汰）→ 建桶 + `loadConversationMessages` 填充。

### 3.4 内存上限（LRU）

所有访问过的会话桶常驻内存会无限增长。加 LRU：只保留最近 N 个会话桶（建议 N=5），淘汰时丢弃其 `messages` 等重字段；**正在运行（isRunning）的会话桶永不淘汰**。被淘汰会话切回时按 3.3 重载。

### 3.5 运行态与"全局占用"

- `isRunning` 变为**每会话**语义（活动会话的 isRunning 决定当前 UI）
- 另设全局派生量 `hasAnyRunning = 任一桶 isRunning`：因后端单例，在**非运行会话**发起请求前用它拦截，提示"有会话正在执行，请等待完成或取消后再发送"
- `handleCancelAgent`：取消的是当前后端唯一 run（对应那个 isRunning 的会话），取消后清该桶运行态

### 3.6 数据流

```
后台会话生成中切走：
  流事件(conversationId=A) → routeStreamEvent → 写入 A 桶（无论前台是否 A）
  UI 只渲染 activeConversationId 对应桶；切回 A → 直接显示 A 桶最新内容（无重载）

切换：
  handleSelectConversation(B) → B 有桶? 直接切active : 建桶+loadConversationMessages → 派生切片刷新
```

## 四、受影响文件

| 文件 | 改动量 | 内容 |
|---|---|---|
| e:\my-project\desktop-tools\src\renderer\lib\hooks\use-chat-session.ts | 大 | 单份 state → 分桶 store；`applyStreamDelta` 路由化；流缓冲按会话；`handleRunAgent`/`handleSelectConversation`/`handleDeleteConversation`/`switchConversationScope` 改为操作指定桶；派生活动切片；LRU；`hasAnyRunning` 拦截 |
| e:\my-project\desktop-tools\src\renderer\lib\hooks\use-app-bootstrap.ts | 小 | 流事件不再"绕过 agent 过滤"，直接交路由 |
| e:\my-project\desktop-tools\src\renderer\App.tsx | 小 | 若保持返回面不变，仅接线新增的删除拦截提示/全局运行态；否则微调 |
| e:\my-project\desktop-tools\src\renderer\features\layout\SidebarPanel.tsx | 小 | 删除按钮对"后台运行中会话"禁用（见 §5） |
| e:\my-project\desktop-tools\src\main\agent\agent-service.ts | **不改** | Scope 1 不动后端；事件已带 conversationId |
| 新增 session-store 纯函数单测 | 中 | 路由、切桶、缓冲隔离、LRU 淘汰、运行态豁免 |

## 五、删除会话的硬约束（本次新增，已确认）

**禁止删除正在后台运行的会话，必须等其执行结束才能删除。**

- 判定："该会话桶 isRunning === true"即视为运行中（不论是否为当前激活会话）
- renderer：`handleDeleteConversation` 开头判断，若目标会话运行中 → 不发起删除，`setRunStatus`/提示"该会话正在执行，结束后才能删除"
- UI：SidebarPanel 会话项的删除按钮，对运行中的会话 `disabled`（当前仅对"激活且 isRunning"禁用，需扩展为"任一运行中会话"）
- 与现状差异：现在删除激活会话会自动切到下一个；新约束下运行中会话根本不允许进入删除流程，无需处理"删除运行中激活会话"的切换

## 六、边界条件与异常处理

1. **内存增长**：LRU 上限（§3.4），运行中会话豁免淘汰
2. **isRunning 语义**：每会话独立；发送前用 `hasAnyRunning` 拦截跨会话并发（后端单例限制）
3. **工具确认弹窗**：`confirmationRequest` 绑定发起它的会话桶，切走不串到别的会话视图；后端单例下同时最多一个确认
4. **删除运行中会话**：禁止（§5）
5. **删除非运行会话**：沿用现状——若删的是激活会话，切到列表中最近的；列表空则自动新建
6. **重启恢复**：`restoreLastActiveSession` 仅恢复活动会话的桶，其余按需重载
7. **切走正在生成的会话再回来**：切回直接见桶内最新内容；run 结束后的落盘/刷新只作用于对应桶
8. **Code 工程会话**：scope 为 `code:{projectId}`，分桶键仍是 conversationId，无差别
9. **可简化的历史补丁**：`matchesStreamEventConversation` 的"丢弃"语义被"路由"取代（保留函数用于判断归属）；"切走时提前落盘用户消息"仍保留（用于重启持久化与被 LRU 淘汰后的重载）

## 七、预期结果

1. 会话间切换即时，无清空重载；被 LRU 淘汰的会话切回时才重载
2. 后台会话生成中，切到其他会话查看不受影响；切回可见实时累积的流式内容
3. 后端仍单实例：运行中不能在别的会话发起新请求，给出明确提示
4. 运行中的会话无法被删除，删除按钮禁用并提示
5. 内存有 LRU 上限，运行中会话不被淘汰
6. `npm run typecheck` 与 `npm test` 通过（含 session-store 纯函数单测）

## 八、非目标（本次不做）

- 后端并发执行多个会话（Scope 2：改造 agentService 单例 run/cancel/确认弹窗）
- 多标签页 / 多面板 UI
- 会话内容的跨设备同步
