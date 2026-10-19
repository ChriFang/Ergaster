# 读取邮件后自动标记已读（email-read-auto-seen）实施总结

## 完成范围
增强 `email_read_message`：读取成功后默认把该邮件标记为已读，可用 `markAsRead=false` 关闭。4 个任务全部完成，typecheck 通过、`npm test` 369 例全过、`build:main` 通过。

## 改动文件（均修改，无新增源码文件）
- `src/main/mail/mail-tools.ts`：`emailReadMessageSchema` 增 `markAsRead?: boolean`；`emailReadMessage` 读取成功后，若 `markAsRead !== false && !detail.seen` 调用既有 `markMessagesSeen([uid], true)` 标记，成功则 `detail.seen=true`，失败以 try/catch 尽力而为并追加提示，不影响读取结果。
- `src/main/mail/mail-format.ts`：新增纯逻辑 `appendAutoSeenNote(reason)` 生成失败提示片段。
- `src/main/mail/mail-format.test.ts`：追加 `appendAutoSeenNote` 单测。
- `src/main/tools/tool-registry.ts`：`email_read_message` parameters 增 `markAsRead`（boolean），description 说明"默认读取后自动标记已读，传 false 仅预览"。

## 关键设计
- **只读边界不变**：读取仍走 `readMessage`（`readOnly:true`）；标记走既有独立可写路径 `markMessagesSeen`，二者分离。
- **尽力而为**：标记失败不影响已返回正文，仅追加"（自动标记已读失败：<原因>）"。
- **幂等/效率**：已读邮件跳过写操作；仅未读时多一次短连接。
- **可逆**：误标可用 `email_mark_unread` 撤销；`markAsRead:false` 保留纯预览能力。
- 无 IPC/preload/shared 改动。

## 验证结果
- `npm run typecheck`：通过。
- `npm test`：369 例全过（含新增 `appendAutoSeenNote` 单测）。
- `build:main`：通过。

## 未覆盖 / 后续
- 真实 IMAP 端到端（读未读→变已读、已读不重复写、标记失败不影响正文）需真实邮箱手动验证，本环境未执行。

## 更正（方案 A：移除 markAsRead 参数）
- 首版把 `markAsRead` 做成模型可控参数。实测在 strict 模式下模型（DeepSeek-V4.1-Flash）会给可选布尔硬填 `false`，导致"缺省即标记已读"失效、读取后仍未读。
- 改为**方案 A**：删除 `markAsRead` 参数，`email_read_message` 读取后**一律**自动标记已读（仅未读时写）。"只预览不改状态"的需求由只读的 `email_list_messages` / `email_search` 覆盖。
- 涉及 `mail-tools.ts`（去掉 schema 字段与条件判断）、`tool-registry.ts`（去掉参数声明、更新描述）。`appendAutoSeenNote` 与其单测保留。typecheck / npm test 复跑通过。
