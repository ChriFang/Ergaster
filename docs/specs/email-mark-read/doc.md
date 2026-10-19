# 邮件标记已读/未读 email-mark-read

> 在既有只读邮件工具基础上，新增**写邮箱状态**的能力：把指定邮件标记为已读（`\Seen`）或未读。这是本项目邮件功能从「只读观察」迈向「修改邮箱」的第一步，边界变更需显式记录。

## 1. 需求场景与处理逻辑

### 1.1 场景
- 用户在会话中说「把这几封标记成已读」「把刚才那封标记未读」，模型先用 `email_list_messages` / `email_search` 拿到 UID，再调用本期新增工具写回 `\Seen` 标志。
- 典型链路：列出/搜索 → 得到 UID → 标记已读/未读 → 工具回报"已标记 N 封"。

### 1.2 处理逻辑（总览）
1. 模型发起 `email_mark_read` / `email_mark_unread`（携带 `uids`）。
2. tool-registry 执行：解析 JSON → Zod 校验 → 因是写操作，**强制确认弹窗**（risk=medium，不进自动放行）。
3. 用户确认后：取账户并解密密码 → 以**非只读**方式打开邮箱 → `messageFlagsAdd/Remove(uids, ['\\Seen'], { uid: true })` → 返回结构化 `ToolResult` → 审计落盘。
4. 拒绝则按现有链路返回"用户拒绝执行"。

### 1.3 提供的工具（2 个，成对交付保证可逆）
| 工具 | 作用 | 风险 |
|---|---|---|
| `email_mark_read` | 按 UID 将邮件标记为已读（添加 `\Seen`） | medium |
| `email_mark_unread` | 按 UID 取消已读（移除 `\Seen`） | medium |

## 2. 架构与技术方案

### 2.1 关键边界变更：只读 → 可写
- 现有 4 个工具全部以 `getMailboxLock(mailbox, { readOnly: true })` 打开邮箱，从协议层保证不改状态。
- 本期**新增独立写路径**（`markMessagesSeen`），使用 `{ readOnly: false }` 打开邮箱执行 STORE FLAGS。**不改动、不复用**现有只读函数，保持只读工具的保证不被稀释。
- 依赖方向、进程边界不变：写操作仍在 main 进程 `imap-client.ts`，工具经 `agentService` 调用链，不涉及 renderer / preload / shared contract 改动（工具是模型能力，不是设置页 IPC 功能）。

### 2.2 确认与风险
- risk=`medium`，`source: { type: 'system' }`，默认弹确认弹窗；`buildConfirmation` 明确写"将把 N 封邮件标记为已读/未读（邮箱 X）"，让用户在批准前知道影响面。
- **自动放行策略（方案 B）**：与其它 medium 系统工具一视同仁，允许用户在确认弹窗勾选"自动运行并记住"。理由：已成对提供 `email_mark_unread`，即使误标为已读也可回滚，风险可逆；不为此改动通用 `canAutoRun` 逻辑。
- 不适用文件写工具的 diff/备份链路（邮件标志位无 diff 语义），确认弹窗是主要防线。

### 2.3 范围收敛（防止误伤整箱）
- 入参 `uids: number[]`：非空、每个为正整数、数量 ≤ `MAIL_LIST_LIMIT_MAX`(50)。
- 禁止 `1:*` 这类通配全选；只接受来自 list/search 结果的显式 UID 数组，避免"一句话把整箱标已读"。

## 3. 影响文件清单

### 3.1 修改文件
| 绝对路径 | 修改类型 | 影响函数/位置 |
|---|---|---|
| `...\src\main\mail\imap-client.ts` | 修改 | 新增 `markMessagesSeen(account, mailbox, uids, seen, signal)`：以 `{ readOnly: false }` 打开邮箱，`seen ? messageFlagsAdd : messageFlagsRemove`，返回请求标记数量 |
| `...\src\main\mail\mail-tools.ts` | 修改 | 新增 `emailMarkRead` / `emailMarkUnread` execute + Zod schema（`emailMarkReadSchema` / `emailMarkUnreadSchema`，含 `uids` 上限校验）|
| `...\src\main\mail\mail-format.ts` | 修改（纯） | 新增 `formatMarkResult(mailbox, count, seen)` 生成回报文案 |
| `...\src\main\tools\tool-registry.ts` | 修改 | `registeredTools` 末尾注册 `email_mark_read` / `email_mark_unread`（risk=medium、`buildConfirmation` 产出可读 summary）|
| `...\src\main\mail\mail-format.test.ts` | 修改 | 追加 `formatMarkResult` 的纯逻辑单测（复用现有测试文件，无需登记新文件）|

### 3.2 不涉及
- 不改 `src/shared/contracts.ts` / `src/preload/index.ts` / renderer：这是模型工具能力，走 `agentService` 调用链，非设置页 IPC。
- 不改 `mail-account-service.ts` / 持久化格式 / `app-paths.ts`。
- 不复用、不修改现有只读函数（`listMessages` / `searchMessages` / `readMessage` 的 `readOnly: true` 保持不变）。

## 4. 关键实现细节

### 4.1 `imap-client.ts` 写路径（节选）
```ts
export async function markMessagesSeen(
  account: MailAccountConfig,
  mailbox: string,
  uids: number[],
  seen: boolean,
  signal: AbortSignal,
): Promise<number> {
  return connectAndRun(toConnParams(account), signal, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly: false }); // 写操作需可写锁
    try {
      if (seen) {
        await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
      } else {
        await client.messageFlagsRemove(uids, ['\\Seen'], { uid: true });
      }
      return uids.length;
    } finally {
      lock.release();
    }
  });
}
```
- 复用现有 `connectAndRun`（AbortSignal→close、finally logout、`describeImapError` 提炼错误），无需新增连接封装。
- 用 UID（`{ uid: true }`）而非序号，避免并发下错标。

### 4.2 工具定义与确认（`tool-registry.ts`，仿 code_edit_file 的 buildConfirmation）
```ts
{
  name: 'email_mark_read',
  description: '将指定 UID 的邮件标记为已读（会修改邮箱状态）。先用 email_list_messages / email_search 获取 UID。',
  risk: 'medium', strict: true,
  parameters: { type: 'object', properties: {
    accountId: { type: 'string' }, mailbox: { type: 'string' },
    uids: { type: 'array', items: { type: 'number' }, description: '要标记的邮件 UID 列表' },
  }, required: ['uids'], additionalProperties: false },
  validator: emailMarkReadSchema,
  timeoutMs: mailToolTimeoutMs,
  source: { type: 'system' },
  buildConfirmation: async (args) => {
    const input = args as z.infer<typeof emailMarkReadSchema>;
    return { summary: `将把 ${input.uids.length} 封邮件标记为已读（邮箱 ${input.mailbox ?? 'INBOX'}）` };
  },
  execute: (args, ctx) => emailMarkRead(args as z.infer<typeof emailMarkReadSchema>, ctx),
}
```
`email_mark_unread` 结构对称（`messageFlagsRemove` + 文案"标记为未读"）。

### 4.3 入参校验（`mail-tools.ts`）
```ts
const uidsField = z.array(z.number().int().min(1)).min(1).max(MAIL_LIST_LIMIT_MAX);
export const emailMarkReadSchema = z.object({
  accountId: accountIdField, mailbox: mailboxField, uids: uidsField,
});
```
- `uids` 非空、正整数、≤50；不接受通配/范围串，杜绝"整箱标记"。

## 5. 边界条件与异常处理
- **确认**：risk=medium 默认弹确认；`buildConfirmation` 给出"将标记 N 封（邮箱 X）"。用户拒绝走既有"用户拒绝执行"返回。
- **自动放行（方案 B）**：允许"自动运行并记住"，与其它 medium 系统工具一致；可逆性由 `email_mark_unread` 保证。
- **账户缺失/连接失败/取消/超时**：复用 `resolveAccount` + `guard` + `connectAndRun`，错误经 `describeImapError` 返回可读原因。
- **UID 不存在**：imapflow 对缺失 UID 通常整体成功忽略；文案回报"请求标记 N 封"，不谎报逐封成功。
- **只读保证**：仅本新增写路径用 `readOnly:false`，其余只读工具不变。

## 6. 数据流路径
模型 `email_mark_read/unread`(uids) → `tool-registry` execute → Zod 校验 → `buildConfirmation` 预览 → `tool:confirm` 弹窗 → 用户确认 → `mail-tools` 取账户(`resolveAccount`)→ `decryptSecret` → `imap-client.markMessagesSeen`（可写锁 + STORE FLAGS）→ `mail-format.formatMarkResult` → `ToolResult` → 审计落盘 → 回传模型。

## 7. 测试策略
- 纯逻辑单测：`formatMarkResult`（已读/未读文案、数量）追加到 `mail-format.test.ts`（复用现有登记，无需改 package.json）。
- IMAP 写操作属集成/手测：用真实/临时邮箱验证标记后 `\Seen` 生效、`email_mark_unread` 可回退。
- 收尾统一 `npm run typecheck` 与 `npm test`。

## 8. 预期结果
- 会话中可让模型把指定邮件标记已读/未读，执行前有明确确认弹窗，且不会误伤整箱。
- 已读/未读成对交付，操作可逆。
- 只读工具的 `readOnly:true` 边界不受影响；写操作集中在单一新增函数，边界清晰、可审计。
