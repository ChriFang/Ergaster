# 多会话独立视图（session-independent-view）实施总结

## 完成情况

| 任务 | 状态 |
|---|---|
| Task 1: 按会话分桶的 session store | 完成（11 个纯函数单测） |
| Task 2: 流事件从丢弃改为路由到对应桶 | 完成 |
| Task 3: 切换即时化 + 运行态每会话语义 | 完成 |
| Task 4: 会话桶 LRU 上限 | 完成 |
| Task 5: 禁止删除运行中会话 | 完成 |
| Task 6: 验证与回归 | typecheck + npm test（235/235）通过；手工验证待用户执行 |

## 核心变更

### 新增
- `src/renderer/lib/utils/session-store.ts` — 纯函数会话桶存储：`SessionState`/`SessionStore` 类型，`ensureSession`（建桶+LRU 淘汰，运行中豁免）、`updateSession`、`removeSession`、`bufferStreamEvent`/`flushSession`（按桶流缓冲）、`appendFilePreviewToSession`、`hasAnyRunning`；`MAX_SESSION_BUCKETS=5`
- `src/renderer/lib/utils/session-store.test.ts` — 11 个单测（建桶/更新/流缓冲隔离/预览去重/删除/LRU 淘汰与运行中豁免）

### 修改
- `src/renderer/lib/hooks/use-chat-session.ts` — 从单份 state 改为持有 `SessionStore`：
  - 全局态保留单份（agents/skills/selectedAgentId/selectedCodeProjectId/activeConversationId/conversationList/attachments）
  - 每会话态收进桶，对外仍从「活动桶」派生 `messages/isRunning/runStatus/lastError/confirmationRequest/filePreviews/expandedToolMessageKeys/cursor`，**返回面基本不变**
  - `activateConversation`：命中桶即时切换（无重载），无桶才 `loadConversationMessages`
  - `applyStreamDelta`：按 `event.conversationId` 路由到对应桶，后台会话照常累积；流缓冲 timer 按会话隔离（`flushTimersRef` Map）
  - `handleRunAgent`：闭包捕获 `runConversationId`，全程按该 id 更新桶（切走后仍正确落到原会话）；`hasAnyRunning` 跨会话发送拦截；`runningConversationIdRef` 记录后端唯一 run
  - `handleCancelAgent`/`handleToolConfirmation`：作用于运行中的会话桶
  - `handleDeleteConversation`：运行中会话禁止删除；删除后 `removeSession`
  - 新增导出 `hasAnyRunning`、`runningConversationIds`、`applyConfirmationRequest`、`ensureConversationBucket`
- `src/renderer/lib/hooks/use-app-bootstrap.ts` — 流事件直接交 `applyStreamDelta` 路由（工作流事件过滤前置，done 事件也路由以冲刷缓冲）；确认请求改用 `applyConfirmationRequest`
- `src/renderer/App.tsx` — 接线 `runningConversationIds` / `applyConfirmationRequest` / `ensureConversationBucket`
- `src/renderer/features/layout/SidebarPanel.tsx` — 新增 `runningConversationIds` prop；删除按钮对运行中会话禁用（不再仅限激活会话）；新增会话按钮去掉 `isRunning` 禁用（多会话下可在别的会话新建）
- `package.json` — 注册 session-store 测试

## 关键设计

1. **保持 hook 返回面**：外部组件消费「活动桶」派生切片，App/ConsolePanel/MessageList 无需改动
2. **流事件路由而非丢弃**：这是"后台实时渲染"的核心——后台会话的 delta 写入其桶，切回即见最新进度
3. **闭包捕获 run 会话 id**：`handleRunAgent` 全程按发起时的 id 更新桶，彻底解决"切走后状态错位"
4. **LRU 运行中豁免**：保证正在生成的后台会话不被淘汰导致丢流

## 范围边界（doc §一 已对齐）

- ✅ 后台查看其他会话、切换即时、后台实时渲染
- ❌ 后端仍单例，不支持并发发起第二个会话请求（`hasAnyRunning` 拦截并提示）
- ❌ 运行中会话禁止删除（本次硬约束）

## 待办：手工验证清单（Task 6.3）

`npm run dev` 后验证：
1. 会话间切换即时、无清空重载
2. A 生成中切到 B 看历史，切回 A 见实时累积的流式内容
3. A 运行中在 B 发送 → 被拦截提示"有会话正在执行"
4. 运行中会话的删除按钮禁用、有 tooltip 提示
5. 访问超过 5 个会话后，最久未用的被淘汰，切回时重载；运行中的不被淘汰
6. 重启恢复上次激活会话；Code 工程会话同样生效

typecheck 与 npm test（235/235）通过。