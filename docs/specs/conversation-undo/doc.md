# 会话撤销（conversation-undo）

## 一、需求背景与目标

当前会话只有"重置会话"（清空全部）能力，无法回退部分对话。目标：每条 user/assistant 消息卡片 hover 时提供**撤销按钮**（置于"复制完整消息"按钮之前），点击确认后**删除该消息及其后所有内容**，上下文回退到它之前。

### 已确认的设计决策

| 决策点 | 结论 |
|---|---|
| 撤销语义 | 按消息截断：删除该消息及其后所有内容（非"仅撤销最后一轮"或"仅撤销回复"） |
| 二次确认 | 需要，window.confirm（与删除会话一致） |
| 按钮位置 | 消息卡片 hover 按钮组，撤销在复制按钮之前 |
| 按钮覆盖范围 | user 与 assistant 消息卡片；tool 折叠条不显示（其撤销语义由所属轮次的 user/assistant 覆盖） |
| 运行约束 | 目标会话 `isRunning` 时禁止撤销（与"运行中会话禁止删除"同一硬约束） |

## 二、现状分析

- 消息卡片现有 hover 按钮组只有一个"复制完整消息"（MessageList.tsx:409-413），无撤销能力
- 既有"重置会话"= 清空整个会话（resetConversation），粒度过粗
- 持久化的每条消息都有稳定 id：user 为 run() 里 `createMessageId('user')`，assistant 为 `assistantMessageId`；id 随消息落盘并在重载后保留，可作截断定位键
- `conversationService.setMessages` 走 `rewriteSegments` 全量重写，自动维护 tokenEstimate/messageCount/updatedAt
- 持久化历史只含 user/assistant 完整轮次（`filterMessagesForPersistence` 剥离 tool 消息与带 tool_calls 的 assistant），从任意 user/assistant 截断不会产生孤立 tool_call/tool_result
- 多会话分桶（session-store）：撤销后按 conversationId 重载该桶即可，天然兼容；桶级 `isRunning` 可做运行守卫

## 三、技术方案

### 3.1 后端：截断 IPC（四层同步）

- `conversation-service.ts` 新增 `truncateToMessage(conversationId, messageId)`：
  - `getAllMessages` 按 `id === messageId` 定位；未命中返回 `{ ok: false, error: '未找到该消息' }`
  - 命中则取 `slice(0, index)`，`setMessages` 整体重写
  - 返回 `ConversationOperationResult`
- `conversation-handlers.ts` 新增 `conversation:truncate` handler
- `contracts.ts` 新增 `truncateConversation: (conversationId: string, messageId: string) => Promise<ConversationOperationResult>`；`preload/index.ts`、`desktop-app-client.ts` 同步透传

### 3.2 截断纯逻辑独立成零依赖模块

截断定位逻辑抽为纯函数 `truncateMessagesFromId(messages, messageId)`（新文件 `src/main/conversation/conversation-truncate.ts`，零依赖），便于在无 Electron 的测试环境单测（项目既有约束：conversation-service 顶层依赖 audit-log/config-service 不可直接单测）。

### 3.3 渲染层

- `use-chat-session.ts` 新增 `handleUndoFromMessage(conversationId, messageId)`：
  - 守卫：目标会话桶 `isRunning === true` → 提示"该会话正在执行，结束后才能撤销"并返回
  - 调用 `truncateConversation` IPC；成功后 `loadConversationMessages(conversationId)` 重载该桶 + `refreshConversationList`（侧边栏 messageCount 同步）
- `MessageList.tsx`：消息卡片按钮组改为 `[撤销][复制]`（撤销在前）；显示条件 `message.id` 存在且非 tool 折叠条；`isRunning` 时禁用；新 prop `onUndoFromMessage`
- `ConsolePanel.tsx` / `ChatConsoleView.tsx`：透传 prop
- `App.tsx`：`window.confirm` 确认（提示不可恢复）后调用 `handleUndoFromMessage`

### 3.4 数据流

```
点击撤销 → confirm → conversation:truncate IPC
  → conversationService.truncateToMessage（按 id 截断 + rewriteSegments 全量重写）
  → renderer loadConversationMessages(该会话) 更新对应桶 → UI 即时反映
  → refreshConversationList 同步侧边栏条数
```

## 四、受影响文件

| 文件 | 类型 | 内容 |
|---|---|---|
| e:\my-project\desktop-tools\src\main\conversation\conversation-truncate.ts | 新增 | 纯函数 truncateMessagesFromId |
| e:\my-project\desktop-tools\src\main\conversation\conversation-truncate.test.ts | 新增 | 单测（命中截断/未命中/空数组/截断到空/不修改原数组） |
| e:\my-project\desktop-tools\src\main\conversation\conversation-service.ts | 修改 | 新增 truncateToMessage |
| e:\my-project\desktop-tools\src\main\conversation\conversation-handlers.ts | 修改 | 新增 conversation:truncate handler |
| e:\my-project\desktop-tools\src\shared\contracts.ts | 修改 | 新增 truncateConversation 声明 |
| e:\my-project\desktop-tools\src\preload\index.ts | 修改 | 透传 |
| e:\my-project\desktop-tools\src\renderer\lib\desktop\desktop-app-client.ts | 修改 | facade |
| e:\my-project\desktop-tools\src\renderer\lib\hooks\use-chat-session.ts | 修改 | handleUndoFromMessage |
| e:\my-project\desktop-tools\src\renderer\features\messages\MessageList.tsx | 修改 | 撤销按钮 + prop |
| e:\my-project\desktop-tools\src\renderer\features\layout\ConsolePanel.tsx / ChatConsoleView.tsx | 修改 | 透传 |
| e:\my-project\desktop-tools\src\renderer\App.tsx | 修改 | confirm + 接线 |
| e:\my-project\desktop-tools\package.json | 修改 | 登记新测试文件（两处列表） |

## 五、边界条件与异常处理

1. **运行中禁止撤销**：目标会话桶 `isRunning` 时 renderer 拦截（按钮禁用 + handler 双保险），与删除会话约束一致
2. **未落盘消息不可撤销**：运行中的乐观消息无 id，按钮不显示
3. **messageId 未命中**（如已被并发操作截断）：返回 `{ok:false}`，renderer 提示并重载该桶纠正视图
4. **撤销到会话开头**：messages 为空是合法状态，UI 回退默认欢迎语
5. **标题/摘要不受影响**：title 保持；摘要随下一次 `shouldSummarize` 触发自然重算
6. **分页**：撤销点可能在首屏 20 条之外——截断在主进程全量消息上执行，与 renderer 分页无关；撤销后重载即得正确首屏
7. **多会话并发**：后端单例下撤销时不可能有其它 run 写同一会话；其它会话的桶不受影响

## 六、预期结果

1. user/assistant 消息卡片 hover 显示撤销按钮（复制按钮之前），tool 折叠条不显示
2. 点击 → 确认弹窗 → 该消息及其后内容从会话删除，UI 即时反映，侧边栏条数同步
3. 会话运行中按钮禁用；撤销不可恢复已在弹窗告知
4. `npm run typecheck` 与 `npm test` 通过（含 truncate 纯函数单测）
