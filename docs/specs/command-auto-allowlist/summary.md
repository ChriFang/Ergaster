# 命令自动执行白名单 - 任务总结

## 完成概览

全部 8 个任务已完成，`npm run typecheck` 通过，`npm test` 400/400 全部通过（含新增的 command-allowlist 单测）。

## 实现内容

### 1. 配置模型（src/shared/config.ts）
- `ToolSettings` 新增 `commandAllowlist` / `commandDenylist` 可选字段。
- 新增 `sanitizeCommandList`：trim + 小写化 + 去重清洗，接入 `sanitizeToolSettings`。
- 老配置文件无新字段时自然回退（undefined），无需迁移。

### 2. 内置清单共享常量（src/shared/command-builtin-list.ts，新建）
- `BUILTIN_READONLY_COMMANDS`：约 150 条内置只读命令（PowerShell cmdlet + 别名 + git/npm/python 等只读子命令 + whoami/ipconfig/tasklist 等系统查询）。
- `DANGEROUS_COMMANDS`：高危 cmdlet 首 token 黑名单（iex、rm、out-file、start-process 等）。
- `SCRIPT_BLOCK_TOLERATED_COMMANDS`：接受脚本块但可放行的 cmdlet 集合。
- 零依赖模块，主进程判定与 renderer 设置界面共用。

### 3. 判定引擎（src/main/tools/command-allowlist.ts，新建，零依赖纯函数）
- 引号/脚本块感知 lexer：按顶层 `;`、换行、`&&`、`||` 拆分语句段；引号内分隔符不拆。
- 危险模式检测：管道、`&` 调用、`$(`、反引号、`@(`、脚本块 `{`、重定向 `>`/`>>`/`<`、`--%`、`-EncodedCommand`、.NET 类型字面量、`New-Object`、`Add-Type`、路径开头执行（`.\`、盘符、引号路径）。
- `evaluateCommandAutoRun`：黑名单 → 危险模式 → 内置清单 → 用户白名单的判定链，任一语句段不通过整体 confirm。
- `extractCommandPrefix`：为确认卡提取「总是允许此命令」的建议前缀（前两 token，黑名单/危险命中返回空）。
- 12 组单测覆盖判定链、绕过样例（`ls $(whoami)`、重定向、多语句、引号内分号、大小写、gitx 非前缀误匹配等）。

### 4. 主进程接入
- `tool-registry.ts` executeToolCall：run_command 专属旁路（仅交互式链路、非 unattended、非 workflow），判定 auto 时并入 autoApproved 并记录审计日志；auto 放行时不计算建议前缀。
- run_command 增加 `buildConfirmation`：摘要 + Shell 标注 + 判定原因。
- `confirmation-service.ts`：`registerConfirmationHandlers` 接收 `appendCommandAllowlist` 回调；`tool:confirm-response` 处理 `autoAllowCommand`，确认时把建议前缀写入全局白名单。
- `config-service.ts` 新增 `appendCommandAllowlist(prefix)`：去重合并后走 saveConfig sanitize 链路持久化。
- `index.ts` 接线注入回调。

### 5. 确认协议四层同步
- `shared/tools.ts`：`ToolConfirmationRequest.commandAutoAllow?: string`、`ToolConfirmationOutcome.autoAllowCommand?: boolean`。
- `shared/contracts.ts` + `preload/index.ts` + `desktop-app-client.ts`：应答 payload 透传。
- `use-chat-session.ts` handleToolConfirmation 透传第三个参数。

### 6. 确认卡 UI（ConfirmationPanel.tsx）
- `commandAutoAllow` 非空时显示「总是允许此命令「<前缀>」（写入全局命令白名单）」复选框；黑名单/危险模式命中的弹窗不显示。

### 7. 设置界面「工具设置」tab
- `app-shell.ts` Tab 类型新增 `'tools'`；`SettingsDialogShell.tsx` 新增「工具设置」入口（Settings2 图标）。
- `ToolsSettingsPanel.tsx`（新建）：命令白名单/黑名单多行编辑器、内置只读清单折叠展示、说明文案；并承接从通用设置迁来的「允许打开的路径」「搜索目录」「草稿目录」。
- `SettingsPanel.tsx` 移除上述三个字段；`config-form.ts` / `settings-model.ts` / `use-settings-state.ts` 同步新字段（打开 tools tab 时重拉配置，与确认卡写入共用同一份 `toolSettings.commandAllowlist`）。
- `App.tsx` 新增 `tools` 分发分支。

### 8. run_powershell_template 降级
- `risk: 'high' → 'medium'`，两个只读模板（listProcesses/listServices）即刻可在智能体编辑器勾选「允许自动执行」。
- `getCommandToolDescription` 更新文案，说明白名单自动执行行为。

## 行为变化（用户视角）

| 场景 | 之前 | 现在 |
|---|---|---|
| `ls`、`cat x`、`git status`、`Get-Process` 等只读命令 | 每次弹确认卡 | 自动执行，不弹窗 |
| 白名单内命令（如 `npm run`） | 每次弹确认卡 | 自动执行 |
| `rm`、`Remove-Item` 等高危命令 | 弹窗 | 弹窗（不变），可勾选「总是允许此命令」 |
| `ls $(whoami)`、`echo x > f`、`a && b` 等复合命令 | 弹窗 | 弹窗，且不提供白名单勾选 |
| 黑名单命中 | 弹窗 | 弹窗，永不提供白名单勾选 |
| 定时任务 / workflow 中的命令 | 拒绝 / 原策略 | 不变（白名单仅交互式会话生效） |
| run_powershell_template | 必弹窗 | 可在智能体清单勾选自动执行 |

## 遗留与后续

- 手动冒烟（8.3）需在运行中的应用里验证：只读命令免确认、弹窗勾选「总是允许此命令」后设置 tab 出现新条目、黑名单弹窗无勾选。
- macOS/Linux（zsh/bash）的内置清单与危险模式目前复用 PowerShell 版常量，跨平台语境清单二期再分平台细化。
- 无人值守链路如需放开内置只读清单，作为独立后续任务。
