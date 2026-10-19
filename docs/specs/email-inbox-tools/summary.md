# 邮件收件箱只读接入（email-inbox-tools）实施总结

## 完成范围
按确认的方案落地：**内置 `email_*` 工具 + 通用 IMAP + 只读 + Electron safeStorage 加密凭据**。全部 10 个任务已完成，`npm run typecheck` 与 `npm test` 均通过，main/preload 构建通过。

对模型开放 4 个只读工具：
- `email_list_mailboxes`（low）：列出邮箱/文件夹
- `email_list_messages`（medium）：按时间倒序列最近邮件信封
- `email_search`（medium）：按发件人/收件人/主题/正文/关键字/时间/已读状态搜索
- `email_read_message`（medium）：按 UID 读取正文与附件元信息

全程以 `getMailboxLock(..., { readOnly: true })` 打开邮箱，不置 `\Seen`、不删改邮件。

## 新增依赖（均 MIT，精确锁版本）
- `imapflow@2.0.5`（Promise 化 IMAP 客户端，自带 TS 类型）
- `mailparser@3.9.28`（MIME 解析）
- `@types/mailparser`（devDependency）
- esbuild 主进程打包对 `imapflow`/`mailparser` 做 `--external`（二者依赖 pino/iconv 等，外置更稳，运行时从 node_modules 加载）

## 新增文件
- `src/shared/mail.ts`：账户/邮件的跨进程类型与常量
- `src/main/mail/mail-secret-store.ts`：safeStorage 加解密封装（不可用即拒绝，无明文降级）
- `src/main/mail/mail-account-utils.ts`（纯）：校验/规范化/掩码/默认账户解析
- `src/main/mail/mail-search-query.ts`（纯）：入参 → imapflow search 条件
- `src/main/mail/mail-format.ts`（纯）：信封/正文/文件夹 → 工具文本
- `src/main/mail/mail-account-service.ts`：账户 CRUD、持久化、内存态一致、默认账户归一
- `src/main/mail/imap-client.ts`：只读 IMAP 操作（list/fetch/search/read/test），绑定 AbortSignal
- `src/main/mail/mail-tools.ts`：4 个工具的 Zod 校验与 execute 编排
- `src/main/mail/mail-handlers.ts`：`mail:*` IPC handler
- `src/renderer/features/settings/MailAccountsPanel.tsx`：账户管理 UI（增删改/设默认/测试连接）
- 单测：`mail-account-utils.test.ts`、`mail-search-query.test.ts`、`mail-format.test.ts`（共 18 例）

## 修改文件
- `src/main/tools/tool-registry.ts`：注册 4 个 `email_*` 工具（`source: system`，`timeoutMs: mailToolTimeoutMs`）
- `src/shared/tools.ts`：新增 `mailToolTimeoutMs = 30_000`
- `src/main/core/app-paths.ts`：新增 `getMailAccountsPath()`
- `src/shared/contracts.ts`、`src/preload/index.ts`：新增 6 个 `mail:*` API（四层同步）
- `src/main/index.ts`：`registerMailHandlers()` + 启动预加载 `mailAccountService.load()`
- `src/renderer/lib/types/app-shell.ts`、`features/layout/SettingsDialogShell.tsx`、`App.tsx`：新增「邮箱账户」设置分区
- `package.json`：新增依赖、外置 mail 库、登记 3 个测试文件到两处列表

## 关键设计与安全
- **凭据**：密码经 `safeStorage.encryptString` → base64 落盘 `~/.desktop-agent/mail-accounts.json`；renderer 只拿到掩码项（`hasPassword`，无明文）；连接时才解密，日志仅记录 host。
- **只读强制**：只读打开邮箱；`email_read_message` 读取 source 时不改标志位。
- **隐私确认**：读取类工具设为 `medium`，默认需用户确认（可按智能体加入自动运行白名单）；`email_list_mailboxes` 为 `low`。
- **健壮性**：连接/greeting/socket 超时 + 工具级 `mailToolTimeoutMs`；`ctx.signal` abort 即 `client.close()`；无账户/连接失败返回可读 `ok:false` 文案并引导去设置页；正文按 `MAIL_BODY_MAX_CHARS` 截断，附件仅返回元信息。
- **多账户**：支持多账户与默认账户；工具可选 `accountId`（id 或名称），缺省用默认。

## 验证结果
- `npm run typecheck`：通过。
- `npm test`：253 例全过（含新增 18 例邮件纯逻辑单测）。
- `npm run build:main` / `build:preload`：通过（mail 库正确外置）。

## 使用方式
1. 设置 → 邮箱账户 → 新增：填账户名、用户名、IMAP 服务器、端口、加密方式、应用专用密码，可「测试连接」，保存。
2. 会话中让智能体「看最近邮件 / 搜某人邮件 / 读取某封邮件」，首次读取会弹确认。

## 未覆盖 / 后续
- 真实 IMAP 端到端联调（testMailAccount 与读取链路）需具备真实邮箱账户，属手动验证，本环境未执行。
- 本期不含发信（SMTP）、回复、转发、标记、移动/删除等写操作；如需可按同一边界另起独立迭代扩展。

## 更正（2026-09-17 联调修复）
- 首次实现时 4 个 `email_*` 工具被误插入 `codeWriteTools`（仅 Code 模式可写工程可用），普通聊天注册表 `registeredTools` 中没有，导致模型收不到邮件工具。经用户通过 `[tools] catalog:` 诊断日志定位。
- 已将 4 个工具移入 `registeredTools` 末尾（run_subagent 之后），`codeWriteTools` 恢复原状；typecheck / npm test / build:main 全部通过。
- 新增诊断日志：`getSystemToolCatalog` 打印 `[tools] catalog: N tools: ...`；`agent-service.run` 打印 `Agent tools prepared: ... toolCount/hasEmailTools`，用于核对运行态工具注册与下发。
