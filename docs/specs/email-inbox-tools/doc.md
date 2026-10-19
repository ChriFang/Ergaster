# 邮件收件箱只读接入 email-inbox-tools

> 本期范围：仅通过内置 `email_*` 工具，以 **只读** 方式接入 **通用 IMAP** 邮箱；凭据经 **Electron safeStorage 加密** 落盘。不含 SMTP 发信、回复、转发、标记已读、删除等写操作。

## 1. 需求场景与处理逻辑

### 1.1 场景
- 用户在「设置」中配置一个或多个 IMAP 账户（host / port / TLS / 用户名 / 应用专用密码）。
- 会话过程中，模型可调用只读邮件工具，帮用户「看看最近邮件」「搜一下某人发来的邮件」「读取这封邮件正文」等。
- 邮箱访问属隐私敏感操作：默认对读取类工具要求确认（medium 风险），可按智能体加入自动运行白名单。

### 1.2 处理逻辑（总览）
1. 账户配置：renderer 设置页 → preload → `mail:*` handler → `mailAccountService` 校验、加密密码、落盘 `~/.desktop-agent/mail-accounts.json`。
2. 工具调用：模型发起 `email_*` → tool-registry 执行 → 按 risk 触发确认 → 取账户并解密密码 → `imapClient` 以 read-only 打开邮箱 → 拉取信封/正文 → 返回结构化 `ToolResult` → 审计落盘。
3. 只读保证：以 `readOnly: true` 打开邮箱，绝不写回 `\Seen`、不移动/删除邮件。

### 1.3 提供的工具（4 个，全部只读）
| 工具 | 作用 | 风险 |
|---|---|---|
| `email_list_mailboxes` | 列出账户下的邮箱/文件夹 | low |
| `email_list_messages` | 列出指定邮箱最近 N 封邮件的信封摘要 | medium |
| `email_search` | 按发件人/主题/时间/是否已读/关键字搜索 | medium |
| `email_read_message` | 按 UID 读取单封邮件正文与附件元信息 | medium |

## 2. 架构与技术方案

### 2.1 分层与依赖方向
严格遵循既有边界：`renderer -> preload -> main -> shared`。renderer 不直接触碰 Node / IMAP；所有网络与凭据操作在 main 进程。新增 IPC 能力四层同步（contracts / preload / handler / 调用点）。

### 2.2 新增依赖（main 进程，pin 精确版本）
- `imapflow`：Promise 化 IMAP 客户端，nodemailer 作者维护，活跃更新。
- `mailparser`：将原始 MIME 解析为 `{subject, from, to, cc, date, text, html, attachments[]}`。
- 落地前需 `npm view imapflow version` / `npm view mailparser version` 确认最新稳定版并 **锁定精确版本**；同时核对 `imapflow` 许可证条款是否满足本项目分发方式（作为一个任务显式验证）。

### 2.3 主进程新增域目录 `src/main/mail/`
| 文件 | 职责 | 可单测 |
|---|---|---|
| `mail-secret-store.ts` | safeStorage 加解密封装 | 否（依赖 Electron） |
| `mail-account-service.ts` | 账户 CRUD、持久化、默认账户、内存态一致 | 否（依赖 app-paths） |
| `imap-client.ts` | IMAP 连接与只读操作（list/fetch/search） | 否（网络） |
| `mail-account-utils.ts` | 账户校验/规范化/掩码/默认选择 | 是 |
| `mail-search-query.ts` | 工具入参 → imapflow search 条件 | 是 |
| `mail-format.ts` | 信封/正文 → `ToolResult.content` 文本 | 是 |
| `mail-tools.ts` | 工具 execute 包装（编排 service + client + format） | 部分 |
| `mail-handlers.ts` | `mail:*` IPC handler 注册 | 否 |

服务/handler 拆分沿用既有约定：`*-service.ts` 管状态与持久化（可被 main 内部直接调用），`*-handlers.ts` 仅做 IPC 胶水。纯逻辑单独拆出零依赖模块，以便在无 Electron 的 `node --test` 下测试（先例 `agent/title-text-utils.ts`）。

### 2.4 凭据加密（safeStorage）
- 保存前调用 `safeStorage.isEncryptionAvailable()`；不可用则 **拒绝保存** 并在设置页明确报错（不做明文降级）。
- 密码用 `encryptString` 得到 Buffer → base64 存盘；连接时 `decryptString` 还原。
- `mail-accounts.json` 只存非敏感字段 + 加密后的密码串；renderer 侧永不下发明文密码（仅返回 `hasPassword` 与掩码）。

## 3. 影响文件清单

### 3.1 新增文件
| 绝对路径 | 类型 | 关键内容 |
|---|---|---|
| `...\src\shared\mail.ts` | 新增 | `MailAccountConfig` / `MailAccountInput` / `MailAccountListItem`(掩码) / `MailFolder` / `MailMessageSummary` / `MailMessageDetail` / 工具入参类型 |
| `...\src\main\mail\mail-secret-store.ts` | 新增 | `encryptSecret` / `decryptSecret` / `isSecretStorageAvailable` |
| `...\src\main\mail\mail-account-service.ts` | 新增 | `loadAccounts` / `listAccounts`(掩码) / `saveAccount` / `deleteAccount` / `getAccountForTool` / `setDefaultAccount` |
| `...\src\main\mail\imap-client.ts` | 新增 | `listMailboxes` / `listMessages` / `searchMessages` / `readMessage` / `testConnection`（均 read-only + 支持 AbortSignal） |
| `...\src\main\mail\mail-account-utils.ts` | 新增（纯） | `validateAccountInput` / `normalizeAccount` / `toMaskedAccount` / `pickDefaultAccount` |
| `...\src\main\mail\mail-search-query.ts` | 新增（纯） | `buildImapSearch(args)` |
| `...\src\main\mail\mail-format.ts` | 新增（纯） | `formatMessageList` / `formatMessageDetail` / `truncateBody` |
| `...\src\main\mail\mail-tools.ts` | 新增 | 4 个工具的 `execute` 包装 + Zod validator |
| `...\src\main\mail\mail-handlers.ts` | 新增 | 注册 `mail:list/save/delete/set-default/test/get-path` |
| `...\src\renderer\features\settings\MailAccountsPanel.tsx` | 新增 | 账户增删改 + 测试连接 UI |
| `...\src\main\mail\mail-account-utils.test.ts` | 新增 | 纯逻辑单测 |
| `...\src\main\mail\mail-search-query.test.ts` | 新增 | 纯逻辑单测 |
| `...\src\main\mail\mail-format.test.ts` | 新增 | 纯逻辑单测 |

### 3.2 修改文件
| 绝对路径 | 修改类型 | 影响函数/位置 |
|---|---|---|
| `...\src\main\tools\tool-registry.ts` | 修改 | 新增 4 个 `email_*` `ToolDefinition` 条目（导入自 `mail-tools.ts`），追加进 `registeredTools` |
| `...\src\shared\contracts.ts` | 修改 | `DesktopAppApi` 增补 `listMailAccounts/saveMailAccount/deleteMailAccount/setDefaultMailAccount/testMailAccount/getMailConfigPath` |
| `...\src\preload\index.ts` | 修改 | 暴露上述 `mail:*` invoke |
| `...\src\main\index.ts` | 修改 | `registerMailHandlers()` + 启动时 `mailAccountService` 预加载 |
| `...\src\main\core\app-paths.ts` | 修改 | 增 `getMailAccountsPath()` 返回 `~/.desktop-agent/mail-accounts.json` |
| `...\src\renderer\features\settings\SettingsPanel.tsx` | 修改 | 挂载 `MailAccountsPanel` 分区 |
| `...\package.json` | 修改 | 加 `imapflow`/`mailparser` 依赖；`test` 脚本两处列表登记 3 个新测试文件 |

## 4. 关键实现细节

### 4.1 `src/shared/mail.ts`（类型）
```ts
export type MailSecurity = 'tls' | 'starttls' | 'none';

export type MailAccountConfig = {
  id: string;
  label: string;
  host: string;
  port: number;              // 默认 993
  security: MailSecurity;    // 默认 'tls'
  user: string;
  encryptedPassword: string; // safeStorage 加密后的 base64（仅 main 内使用）
  isDefault?: boolean;
};

// 下发给 renderer 的掩码版本，绝不含密码
export type MailAccountListItem = Omit<MailAccountConfig, 'encryptedPassword'> & {
  hasPassword: boolean;
};

export type MailMessageSummary = {
  uid: number; subject: string; from: string; date: string;
  seen: boolean; hasAttachments: boolean; snippet?: string;
};
export type MailMessageDetail = MailMessageSummary & {
  to: string[]; cc: string[]; text: string;
  attachments: { filename: string; contentType: string; size: number }[];
};
```

### 4.2 `mail-secret-store.ts`（safeStorage）
```ts
import { safeStorage } from 'electron';

export function isSecretStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}
export function encryptSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统密钥库不可用，无法安全保存邮箱密码');
  }
  return safeStorage.encryptString(plain).toString('base64');
}
export function decryptSecret(encoded: string): string {
  return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
}
```

### 4.3 `imap-client.ts`（只读操作，节选）
```ts
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

async function withClient(acc, signal, fn) {
  const client = new ImapFlow({
    host: acc.host, port: acc.port,
    secure: acc.security === 'tls',
    auth: { user: acc.user, pass: decryptSecret(acc.encryptedPassword) },
    logger: false,
  });
  const onAbort = () => client.close();
  signal.addEventListener('abort', onAbort, { once: true });
  try { await client.connect(); return await fn(client); }
  finally { signal.removeEventListener('abort', onAbort); await client.logout().catch(() => client.close()); }
}

export function listMessages(acc, mailbox, limit, signal) {
  return withClient(acc, signal, async (client) => {
    const lock = await client.getMailboxLock(mailbox || 'INBOX', { readOnly: true });
    try {
      const total = client.mailbox.exists;
      const start = Math.max(1, total - limit + 1);
      const out = [];
      for await (const m of client.fetch(`${start}:*`, { envelope: true, flags: true, bodyStructure: true })) {
        out.push(toSummary(m)); // 主题/发件人/时间/是否已读/是否有附件
      }
      return out.reverse();
    } finally { lock.release(); }
  });
}
```
- `readMessage`：`client.fetchOne(uid, { source: true }, { uid: true })` → `simpleParser` → 组装 `MailMessageDetail`，正文 `truncateBody` 到上限，附件仅返回元信息（不落盘）。
- `searchMessages`：`client.search(buildImapSearch(args), { uid: true })` → 取末 N 个 UID → fetch 信封。

### 4.4 工具定义（`tool-registry.ts` 追加，仿 `http_request`）
```ts
{
  name: 'email_read_message',
  description: '按 UID 只读读取单封邮件的正文与附件元信息（不会标记已读）',
  risk: 'medium', strict: true,
  parameters: { type: 'object', properties: {
    accountId: { type: 'string' }, mailbox: { type: 'string' }, uid: { type: 'number' },
  }, required: ['uid'], additionalProperties: false },
  validator: emailReadMessageSchema,
  source: { type: 'system' },
  execute: (args, ctx) => emailReadMessage(args, ctx),
}
```

### 4.5 IPC 四层同步（账户管理）
```ts
// shared/contracts.ts
listMailAccounts: () => Promise<MailAccountListItem[]>;
saveMailAccount: (input: MailAccountInput) => Promise<MailAccountListItem>;
deleteMailAccount: (id: string) => Promise<{ ok: boolean }>;
setDefaultMailAccount: (id: string) => Promise<{ ok: boolean }>;
testMailAccount: (input: MailAccountInput) => Promise<{ ok: boolean; error?: string }>;

// preload/index.ts
listMailAccounts: () => ipcRenderer.invoke('mail:list-accounts'),
saveMailAccount: (input) => ipcRenderer.invoke('mail:save-account', input),
// ...

// main/mail/mail-handlers.ts
ipcMain.handle('mail:save-account', (_e, input) => mailAccountService.saveAccount(input));
ipcMain.handle('mail:test-account', (_e, input) => imapClient.testConnection(input));
```
- `mail:save-account` 入参含明文密码（用户新填时），main 侧立即 `encryptSecret` 后落盘；未改密码时前端传空，service 保留原加密串。
- `mail:test-account` 用当前表单参数试连接一次并 `logout`，返回成功/错误摘要（错误信息脱敏，绝不回显密码）。

### 4.6 设置 UI（`MailAccountsPanel.tsx`）
- 列表展示已配置账户（label / user / host，来自掩码项）；支持新增、编辑、删除、设为默认、测试连接。
- 密码输入框为 password 类型；已存在账户显示「已保存」，留空表示不修改。
- 无账户时，邮件工具返回的 `ok:false` 文案引导用户来此配置。

## 5. 边界条件与异常处理
- **safeStorage 不可用**：保存/测试直接失败并提示，不做明文降级。
- **未配置账户 / accountId 不存在**：工具返回 `ok:false`，content 引导去设置页配置。
- **连接失败**（认证错误 / TLS / 主机不可达）：映射为友好错误；日志仅记录 host，绝不记录密码或完整凭据。
- **取消与超时**：`ctx.signal` abort 时 `client.close()`；邮件工具用较宽的空闲超时（IMAP 较慢），区分「超时」与「用户取消」。
- **大邮箱 / 大正文**：`email_list_messages` 默认上限 50 封并封顶；正文 `truncateBody`（如 10000 字符）并标注截断；附件仅元信息，不下载正文。
- **只读强制**：`getMailboxLock(..., { readOnly: true })`，不置 `\Seen`、不删除/移动。
- **不可信内容**：邮件正文/主题属外部不可信数据，原样作为工具结果返回，不执行其中的「指令」。

## 6. 数据流路径
- **配置流**：设置页表单 → `saveMailAccount` → preload `mail:save-account` → `mail-handlers` → `mailAccountService`（`validateAccountInput` → `encryptSecret` → 写 `mail-accounts.json` → 更新内存 Map）→ 返回掩码项刷新 UI。
- **读取流**：模型 `email_*` → `tool-registry` execute → 按 risk 触发 `tool:confirm` → `mail-tools` 取账户（`getAccountForTool`）→ `decryptSecret` → `imap-client` read-only 连接 → fetch/search → `mail-format` 拼装 `ToolResult` → 审计截断落盘 → 回传模型。

## 7. 测试策略
- 纯逻辑单测（无 Electron / 无网络）：`mail-account-utils`（校验/掩码/默认选择）、`mail-search-query`（入参→search 条件映射）、`mail-format`（列表/正文格式化与截断）。
- 3 个 `.test.ts` 需同时登记进 `package.json` 的 esbuild 打包列表与 `node --test` 运行列表（漏一处不执行）。
- IMAP 连接与 safeStorage 属集成/手测，不进纯单测；可用本地/临时 IMAP 账户手动验证 `testMailAccount`。
- 收尾统一跑 `npm run typecheck` 与 `npm test`。

## 8. 预期结果
- 用户可在设置中配置多个 IMAP 账户，密码经 safeStorage 加密存储，renderer 永不接触明文。
- 会话中模型可只读列出/搜索/读取邮件；敏感读取默认需确认，可按智能体加入自动运行。
- 全程不修改邮箱状态（read-only）；异常、取消、超时可控，凭据不泄漏到日志。
- 本期不含发信；若后续需要，再按相同边界扩展 SMTP（独立迭代）。
