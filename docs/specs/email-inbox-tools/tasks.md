# 邮件收件箱只读接入（email-inbox-tools）实施计划

- [x] 任务 1：引入 IMAP 依赖并校验
    - 1.1：`npm view imapflow version` / `npm view mailparser version` 确认最新稳定版
    - 1.2：以精确版本安装 `imapflow`、`mailparser` 并写入 package.json dependencies
    - 1.3：核对 `imapflow` 许可证是否满足本项目分发方式，记录结论
    - 1.4：运行 `npm run typecheck` 确认依赖类型可用

- [x] 任务 2：定义共享类型与数据路径
    - 2.1：新建 `src/shared/mail.ts`，定义 MailSecurity / MailAccountConfig / MailAccountInput / MailAccountListItem(掩码) / MailFolder / MailMessageSummary / MailMessageDetail 及 4 个工具入参类型
    - 2.2：在 `src/main/core/app-paths.ts` 增加 `getMailAccountsPath()`，返回 `~/.desktop-agent/mail-accounts.json`

- [x] 任务 3：实现纯逻辑模块与单测
    - 3.1：`mail-account-utils.ts`：validateAccountInput / normalizeAccount / toMaskedAccount / pickDefaultAccount
    - 3.2：`mail-search-query.ts`：buildImapSearch(args) 将工具入参映射为 imapflow search 条件
    - 3.3：`mail-format.ts`：formatMessageList / formatMessageDetail / truncateBody
    - 3.4：为上述三模块编写 `.test.ts`（覆盖校验失败、掩码、默认选择、条件映射、正文截断标注）

- [x] 任务 4：实现凭据加密存储 mail-secret-store
    - 4.1：封装 isSecretStorageAvailable / encryptSecret / decryptSecret（基于 Electron safeStorage）
    - 4.2：safeStorage 不可用时抛出明确错误，禁止明文降级

- [x] 任务 5：实现账户服务 mail-account-service
    - 5.1：启动加载 `mail-accounts.json` 到内存 Map，缺失时回退空配置
    - 5.2：saveAccount（新填密码即 encryptSecret，留空则保留原加密串）、deleteAccount、setDefaultAccount
    - 5.3：listAccounts 返回掩码项（hasPassword，不含密码）；getAccountForTool 按 accountId/默认账户解析
    - 5.4：确保写盘与内存态一致

- [x] 任务 6：实现 IMAP 只读客户端 imap-client
    - 6.1：withClient 连接封装：secure/auth、绑定 AbortSignal→close、finally logout
    - 6.2：listMailboxes / listMessages（readOnly 打开、取末 N 封信封、上限封顶 50）
    - 6.3：searchMessages（buildImapSearch → search → fetch 信封）
    - 6.4：readMessage（fetchOne source → simpleParser → 组装 detail、truncateBody、附件仅元信息）
    - 6.5：testConnection（试连接并 logout，错误摘要脱敏）

- [x] 任务 7：实现邮件工具并注册
    - 7.1：`mail-tools.ts` 编写 4 个工具的 Zod validator 与 execute 包装（编排 service + client + format）
    - 7.2：无账户 / accountId 不存在时返回 ok:false 并引导去设置页配置
    - 7.3：在 `tool-registry.ts` 追加 email_list_mailboxes(low) / email_list_messages(medium) / email_search(medium) / email_read_message(medium) 的 ToolDefinition，source=system
    - 7.4：确认工具执行经既有审计日志记录

- [x] 任务 8：打通 IPC 四层
    - 8.1：`shared/contracts.ts` 增补 listMailAccounts / saveMailAccount / deleteMailAccount / setDefaultMailAccount / testMailAccount / getMailConfigPath
    - 8.2：`preload/index.ts` 暴露对应 mail:* invoke
    - 8.3：新建 `mail-handlers.ts` 注册 ipcMain.handle；在 `main/index.ts` 调用 registerMailHandlers() 并预加载账户服务
    - 8.4：handler 层错误信息脱敏，绝不回显密码

- [x] 任务 9：实现设置页账户管理 UI
    - 9.1：新建 `MailAccountsPanel.tsx`：账户列表 + 新增 / 编辑 / 删除 / 设为默认 / 测试连接
    - 9.2：密码框为 password 类型，已存在账户显示「已保存」，留空表示不修改
    - 9.3：在 `SettingsPanel.tsx` 挂载邮件账户分区

- [x] 任务 10：登记测试并整体验证
    - 10.1：将 3 个 `.test.ts` 登记进 package.json 的 esbuild 打包列表与 node --test 运行列表
    - 10.2：运行 `npm test`
    - 10.3：运行 `npm run typecheck`
    - 10.4：具备 IMAP 账户时，手动验证 testMailAccount 与工具只读读取链路
