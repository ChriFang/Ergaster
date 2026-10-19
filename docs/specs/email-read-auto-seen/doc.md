# 读取邮件后自动标记已读 email-read-auto-seen

> 对现有 `email_read_message` 的增强：成功读取单封邮件后，顺带把该邮件标记为已读（`\Seen`）。默认开启，可通过参数关闭。属既有 email-inbox-tools / email-mark-read 的小幅行为扩展。

## 1. 需求场景与处理逻辑

### 1.1 场景
- 用户「打开/阅读某封邮件」后，希望它像常规邮件客户端一样自动变为已读，无需再单独调用 `email_mark_read`。

### 1.2 处理逻辑
1. 模型调用 `email_read_message`（可带 `markAsRead`，默认 `true`）。
2. 先按既有只读路径 `readMessage` 取正文与附件元信息（`readOnly:true`，不变）。
3. 读取成功后，若 `markAsRead !== false` 且该邮件当前未读，调用既有写路径 `markMessagesSeen(account, mailbox, [uid], true, signal)` 标记 `\Seen`。
4. 标记为**尽力而为**：失败不影响读取结果，仅在返回文本追加一句「（自动标记已读失败：<原因>）」。
5. 返回的 `detail.seen` 反映标记后的状态。

## 2. 架构与技术方案

### 2.1 边界处理
- **不改 `readMessage` 的只读本质**：读取仍 `readOnly:true`；标记走已有 `markMessagesSeen`（独立可写连接），二者分离，只读保证不被稀释。
- 复用现有 `markMessagesSeen` / `connectAndRun`，不新增 IMAP 封装。
- 无 IPC / preload / shared 改动（工具能力，走 agentService 调用链）。

### 2.2 确认与风险
- `email_read_message` 维持 risk=`medium`，读取时已有确认弹窗；自动标记已读被这次读取确认覆盖，不新增弹窗。
- 可逆：误标可用 `email_mark_unread` 撤销。

### 2.3 幂等 / 效率
- 已读邮件跳过标记（`detail.seen === true` 时不再写），省一次写连接。
- 未读时多一次短连接写 `\Seen`，可接受。

## 3. 影响文件清单（均修改，无新增）
| 绝对路径 | 修改 |
|---|---|
| `...\src\main\mail\mail-tools.ts` | `emailReadMessageSchema` 加 `markAsRead?: boolean`；`emailReadMessage` 读取成功后按条件调用 `markMessagesSeen`（try/catch 尽力而为），并把 `detail.seen` 置为已读 |
| `...\src\main\mail\mail-format.ts` | `formatMessageDetail` 支持在末尾追加自动标记结果提示（或由工具层拼接）；新增/调整纯逻辑，配套单测 |
| `...\src\main\mail\mail-format.test.ts` | 追加"自动标记提示"相关断言 |
| `...\src\main\tools\tool-registry.ts` | `email_read_message` 的 parameters 增加 `markAsRead`（boolean，说明默认已读） |

## 4. 关键实现细节
```ts
// mail-tools.ts
export const emailReadMessageSchema = z.object({
  accountId: accountIdField,
  mailbox: mailboxField,
  uid: z.number().int().min(1),
  markAsRead: z.boolean().optional(), // 默认 true
});

export async function emailReadMessage(args, context) {
  const account = await mailAccountService.resolveAccount(args.accountId);
  if (!account) return fail(...);
  return guard(context, async () => {
    const mailbox = args.mailbox ?? DEFAULT_MAILBOX;
    const detail = await readMessage(account, mailbox, args.uid, context.signal);
    let markNote = '';
    const shouldMark = args.markAsRead !== false && !detail.seen;
    if (shouldMark) {
      try {
        await markMessagesSeen(account, mailbox, [detail.uid], true, context.signal);
        detail.seen = true;
      } catch (error) {
        markNote = `\n\n（自动标记已读失败：${error instanceof Error ? error.message : '未知原因'}）`;
      }
    }
    return { ok: true, content: formatMessageDetail(detail) + markNote, data: { account: account.label, mailbox, message: detail } };
  });
}
```

## 5. 边界条件与异常
- `markAsRead:false`：只读不标记（保留预览能力）。
- 已读邮件：跳过写操作。
- 标记失败/超时/取消：不影响已返回的正文，附提示；取消时 guard 统一返回"已取消"。
- 只读工具（list/search）与 `readMessage` 的 `readOnly:true` 不受影响。

## 6. 数据流
模型 `email_read_message`(uid[, markAsRead]) → 确认 → `readMessage`(只读) → 成功且需标记 → `markMessagesSeen`(可写，尽力而为) → `formatMessageDetail` + 提示 → ToolResult → 审计 → 回传。

## 7. 测试策略
- 纯逻辑单测：`formatMessageDetail`/提示拼接（`mail-format.test.ts`，复用登记）。
- 标记链路属集成/手测：读未读邮件后确认变已读、`markAsRead:false` 不变、已读邮件不重复写。
- 收尾 `npm run typecheck` + `npm test`。

## 8. 预期结果
- 读取未读邮件后自动变已读，符合常规邮件客户端习惯；可用 `markAsRead:false` 预览不改状态，误标可 `email_mark_unread` 回滚。
- 只读边界不受影响，标记失败不影响读取。
