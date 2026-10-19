# 邮件标记已读/未读（email-mark-read）实施计划

- [✓] 任务 1：新增 IMAP 写路径 markMessagesSeen
    - 1.1：在 `imap-client.ts` 新增 `markMessagesSeen(account, mailbox, uids, seen, signal)`
    - 1.2：以 `getMailboxLock(mailbox, { readOnly: false })` 打开邮箱（写操作需可写锁）
    - 1.3：`seen ? messageFlagsAdd : messageFlagsRemove`，均传 `['\\Seen']` 与 `{ uid: true }`
    - 1.4：复用 `connectAndRun`（AbortSignal→close、finally logout、describeImapError），返回请求标记的数量
    - 1.5：保持现有只读函数（listMessages/searchMessages/readMessage）不变

- [✓] 任务 2：结果文案 formatMarkResult 与单测
    - 2.1：在 `mail-format.ts` 新增 `formatMarkResult(mailbox, count, seen)`，措辞用"已请求将 N 封邮件标记为已读/未读（邮箱 X）"，不谎报逐封成功
    - 2.2：在 `mail-format.test.ts` 追加已读/未读文案与数量的纯逻辑单测（复用现有测试文件，无需登记 package.json）

- [✓] 任务 3：邮件标记工具 execute 与入参校验
    - 3.1：在 `mail-tools.ts` 新增 `uidsField`（`z.array(z.number().int().min(1)).min(1).max(MAIL_LIST_LIMIT_MAX)`）
    - 3.2：定义 `emailMarkReadSchema` / `emailMarkUnreadSchema`（accountId? / mailbox? / uids）
    - 3.3：实现 `emailMarkRead` / `emailMarkUnread`：`resolveAccount` +（账户缺失走 NO_ACCOUNT_HINT）+ `guard` + `markMessagesSeen` + `formatMarkResult`

- [✓] 任务 4：注册工具并接入确认弹窗
    - 4.1：在 `tool-registry.ts` 的 `registeredTools` 末尾注册 `email_mark_read` / `email_mark_unread`
    - 4.2：risk=`medium`、`source: { type: 'system' }`、`timeoutMs: mailToolTimeoutMs`
    - 4.3：实现 `buildConfirmation` 输出"将把 N 封邮件标记为已读/未读（邮箱 X）"
    - 4.4：确认策略采用方案 B——不改 `canAutoRun`，允许"自动运行并记住"（可逆性由 email_mark_unread 保证）

- [✓] 任务 5：整体验证
    - 5.1：`npm run typecheck`
    - 5.2：`npm test`
    - 5.3：核对 `[tools] catalog` 出现两个新工具，且只读工具行为未受影响
    - 5.4：具备邮箱时手动验证：标记已读生效、email_mark_unread 可回退、确认弹窗文案正确
