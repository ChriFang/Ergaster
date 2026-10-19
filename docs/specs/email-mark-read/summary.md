# 邮件标记已读/未读（email-mark-read）实施总结

## 完成范围
在既有只读邮件工具之上，新增两个**写邮箱状态**的工具，全部 5 个任务完成，`npm run typecheck` 通过、`npm test` 258 例全过、`build:main` 通过。

| 工具 | 作用 | 风险 |
|---|---|---|
| `email_mark_read` | 按 UID 将邮件标记为已读（添加 `\Seen`） | medium |
| `email_mark_unread` | 按 UID 取消已读（移除 `\Seen`） | medium |

## 改动文件
- `src/main/mail/imap-client.ts`：新增写路径 `markMessagesSeen(account, mailbox, uids, seen, signal)`——以 `getMailboxLock(mailbox, { readOnly: false })` 打开邮箱，`seen` 用 `messageFlagsAdd` 否则 `messageFlagsRemove`（`{ uid: true }`），复用 `connectAndRun`（取消/超时/错误提炼），返回请求标记数量。现有只读函数（`listMessages`/`searchMessages`/`readMessage` 的 `readOnly: true`）保持不变。
- `src/main/mail/mail-format.ts`：新增纯逻辑 `formatMarkResult(mailbox, count, seen)`，措辞"已请求将 N 封邮件标记为已读/未读（邮箱 X）"，不谎报逐封成功。
- `src/main/mail/mail-format.test.ts`：追加 `formatMarkResult` 单测（复用现有测试文件，无需改 package.json）。
- `src/main/mail/mail-tools.ts`：新增 `uidsField`（非空、正整数、≤50）与 `emailMarkReadSchema`/`emailMarkUnreadSchema`；`emailMarkRead`/`emailMarkUnread` 经 `resolveAccount` + `guard` + `markMessagesSeen` + `formatMarkResult`。
- `src/main/tools/tool-registry.ts`：`registeredTools` 末尾注册两个工具（risk=medium、source=system、timeoutMs=mailToolTimeoutMs、`buildConfirmation` 输出可读 summary）。

## 关键设计
- **只读→可写边界**：写操作集中在单一新增函数 `markMessagesSeen`，用可写锁；不复用/不改动只读路径，只读工具的保证不被稀释。
- **确认策略（方案 B）**：risk=medium 默认弹确认（`buildConfirmation` 显示"将标记 N 封（邮箱 X）"）；不改通用 `canAutoRun`，允许"自动运行并记住"。理由：已成对提供 `email_mark_unread`，误标可回滚，风险可逆。
- **防误伤整箱**：只接受来自 list/search 的显式 UID 数组，`uids` 上限 50，禁止 `1:*` 通配全选。
- **无 IPC/renderer 改动**：属模型工具能力，走 agentService 调用链。

## 验证结果
- `npm run typecheck`：通过。
- `npm test`：258 例全过（含新增 `formatMarkResult` 单测）。
- `build:main`：通过，`dist/main/index.js` 已含 `email_mark_read`/`email_mark_unread`。

## 未覆盖 / 后续
- 真实 IMAP 端到端（标记生效、未读回退、确认弹窗文案）需真实邮箱手动验证，本环境未执行。
- imapflow 对不存在的 UID 通常静默忽略，故结果文案用"已请求"而非逐封确认。
