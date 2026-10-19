# 读取邮件后自动标记已读（email-read-auto-seen）实施计划

- [x] 任务 1：扩展 email_read_message 入参与自动标记逻辑
    - 1.1：`mail-tools.ts` 的 `emailReadMessageSchema` 增加 `markAsRead: z.boolean().optional()`（默认视为 true）
    - 1.2：`emailReadMessage` 在 `readMessage` 成功后，若 `markAsRead !== false && !detail.seen`，调用 `markMessagesSeen(account, mailbox, [detail.uid], true, context.signal)`
    - 1.3：标记成功则将 `detail.seen = true`；标记失败以 try/catch 吞掉，仅在返回文本追加"（自动标记已读失败：<原因>）"，不影响读取结果
    - 1.4：保持 `readMessage` 只读路径（readOnly:true）不变

- [x] 任务 2：结果文案与单测
    - 2.1：在 `mail-format.ts` 抽出可测的提示拼接（如 `appendAutoSeenNote(text, note)` 或在工具层拼接，择一并保持纯逻辑可测）
    - 2.2：在 `mail-format.test.ts` 追加断言：标记失败提示存在、成功时无提示

- [x] 任务 3：更新工具 schema 声明
    - 3.1：`tool-registry.ts` 的 `email_read_message` parameters 增加 `markAsRead`（boolean，描述：默认读取后标记为已读，传 false 则仅预览不改状态）
    - 3.2：`email_read_message` 的 description 补充"默认读取后自动标记已读"

- [x] 任务 4：整体验证
    - 4.1：`npm run typecheck`
    - 4.2：`npm test`
    - 4.3：具备邮箱时手动验证：读未读邮件后变已读、`markAsRead:false` 保持未读、已读邮件不重复写、标记失败不影响正文返回
