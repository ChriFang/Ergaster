# 命令自动执行白名单（command-auto-allowlist）

## 1. 背景与目标

当前 `run_command` / `run_powershell_template` 均硬编码 `risk: 'high'`（src/main/tools/tool-registry.ts:955、979），每次执行都弹确认卡，对 `ls`、`cat`、`git status` 等只读命令体验过重。

目标：引入业界主流的「内置只读放行清单 + 用户自定义白/黑名单 + 防绕过检测」三层机制，在保持安全兜底的前提下减少确认打断。**定位：白名单是效率优化，不是安全边界**——任何检测不确定的情形一律回落弹窗。

同时按用户要求：设置界面新增「工具设置」tab，白名单配置从现有 SettingsPanel（通用 tab）迁移/收拢到该 tab，未来工具相关配置统一归口。

## 2. 业界结论（评估摘要）

- Claude Code：内置只读命令自动放行（`ls`/`cat`/`git status` 等）+ 用户 `permissions.allow/deny/ask` 前缀规则，deny 优先；allow 命中仍做可疑模式检测（命令注入、管道到 shell、危险重定向降级为弹窗）。
- Cursor：Auto-run + Command allowlist（前缀匹配），后转向沙箱方案引发社区反弹——用户既要自动化也要可控性。
- Roo Code：`allowedCommands` + `deniedCommands` 双清单，最长前缀匹配、deny 平局获胜。
- Copilot Agent：Manual / Assisted（LLM 判官）/ Allow all 三档 + 终端正则白名单 + 沙箱独立于审批层。
- 已知绕过教训：`ls $(whoami)` 会先执行子命令——前缀匹配必须配合复合命令/子表达式检测，否则白名单形同虚设。

## 3. 总体设计

### 3.1 判定链（run_command 执行前，主进程 tool-registry 接入）

```
1. 命中用户黑名单            → 强制弹窗（deny 优先，且勾选框不提供）
2. 含危险模式（防绕过检测）   → 强制弹窗（优先级高于白名单）
3. 命中内置只读清单           → 自动执行
4. 命中用户白名单（前缀）     → 自动执行
5. 都未命中                  → 弹窗；弹窗新增「总是允许此命令」勾选 → 写入用户白名单
```

生效范围说明：
- 仅作用于**交互式会话链路**；无人值守（定时任务）链路维持现状：high 一律拒绝（后续如需放开只读清单，二期再做）。
- workflow / 子智能体链路维持现状（带 workflowMeta 不走自动执行名单，见 auto-execute.ts:19-21）。

### 3.2 配置模型（全局 config.json，不放 Agent 级）

`ToolSettings`（src/shared/config.ts:1-5）新增两个字段：

```ts
export type ToolSettings = {
  allowedPaths?: string[];
  searchRoots?: string[];
  draftDirectory?: string;
  /** 命令自动执行白名单：按首个 token 前缀匹配，大小写不敏感（Windows）。 */
  commandAllowlist?: string[];
  /** 命令黑名单：优先级最高，命中即强制弹窗。 */
  commandDenylist?: string[];
};
```

- 全局配置而非 Agent 级的理由：现有 `autoExecuteTools` 是工具粒度；命令粒度再叠一层 Agent 级复杂度收益低，且白名单语义是「这台机器上我信任哪些命令」。
- sanitize：复用 `sanitizeStringArray`，白名单条目统一小写化存储（Windows PowerShell 大小写不敏感）；去重；黑名单条目同样小写化。
- 默认值：两个清单均为空；安全基线由内置只读清单承担（见 3.4）。

### 3.3 内置只读清单（PowerShell 语境）

Windows 下 run_command 实际是 `powershell.exe -NoProfile -Command <整条命令>`（system-tools.ts:1648-1670），清单需覆盖 PowerShell 别名。初稿：

| 类别 | 命令（含 PowerShell 别名） |
|---|---|
| 目录浏览 | `Get-ChildItem`(`ls`,`dir`,`gci`)、`Set-Location`(`cd`,`sl`)、`Get-Location`(`pwd`,`gl`)、`Get-Item`(`gi`)、`Get-ChildItem` 递归参数 |
| 文件读取 | `Get-Content`(`cat`,`gc`,`type`)、`Select-String`(`sls`)、`Get-FileHash`、`Format-Hex` |
| 文本/对象输出 | `Write-Output`(`echo`,`write`)、`Write-Host`、`Out-String`、`Measure-Object`、`Measure-Command`、`Sort-Object`(`sort`)、`Group-Object`、`Select-Object`(`select`)、`Where-Object`(`where`)、`ForEach-Object`(`foreach`)*、`Compare-Object`(`diff`)、`Tee-Object`?（否—— tee 写文件，剔除） |
| 系统/进程查询 | `Get-Process`(`ps`)、`Get-Service`(`gsv`)、`Get-ComputerInfo`、`Get-Date`、`Get-Host`、`Get-PSDrive`(`gdr`)、`Get-PSProvider`、`Get-Command`(`gcm`)、`Get-Member`(`gm`)、`Get-Help`、`Get-Variable`(`gv`)、`Get-Alias`(`gal`)、`Get-History`(`h`)、`Get-Culture`、`Get-UICulture`、`Get-Random`、`Get-Unique`(`gu`)、`Get-ChildItem` 环境变量（`Get-ChildItem Env:` 走同一条目） |
| 网络查询（只读） | `Test-Connection`、`Resolve-DnsName`、`ping`、`ipconfig`、`whoami`、`hostname`、`systeminfo`、`tasklist` |
| git/版本控制（只读） | `git status`、`git log`、`git diff`、`git show`、`git branch`、`git remote`、`git config --get`、`git rev-parse`、`git blame`、`git ls-files` |
| 开发工具查询 | `node --version`/`node -v`、`npm --version`/`npm -v`、`python --version`、`where`、`Get-Command` |

*`ForEach-Object`：脚本块参数可写文件（`% { $_ | Out-File x }`），但防绕过检测已拦截 `Out-File`/重定向前的写路径——保留 `ForEach-Object` 放行，配合 3.5 的危险模式检测兜底（块内出现写 cmdlet 时整体判危险）。实现上：内置清单为「首 token 白名单」，`ForEach-Object`/`Where-Object`/`Select-Object` 等接受脚本块的 cmdlet 追加「块内容也必须命中只读清单」的递归校验；校验不通过 → 弹窗。

> 实现时以常量表形式落在纯函数模块中，macOS/Linux 的 zsh/bash 清单后续复用同一结构扩展（本期 Windows 为主，跨平台清单结构先统一）。

### 3.4 防绕过检测（危险模式，命中即弹窗）

对整条命令字符串（先做基础规范化）检测以下任一模式：

1. **复合/链式**：`;`、`&&`、`||`、`|`（管道）、`&`（后台/调用）、换行
2. **子表达式**：`$(`、反引号 `` ` ``（PowerShell 转义与子表达式）、`@(`（数组子表达式/哈希字面量视上下文，保守处理）
3. **重定向**：`>`、`>>`、`<`、`2>`、`*>` 等
4. **脚本块**：`{` `}`（接受脚本块的 cmdlet 由 3.3 递归校验，其余出现 `{` 一律判危险）
5. **高危 cmdlet/调用**：`Invoke-Expression`(`iex`)、`Invoke-Command`(`icm`)、`Start-Process`(`start`/`saps`)、`Start-Job`、`Invoke-Item`(`ii`)、`Invoke-WebRequest`(`iwr`)、`Invoke-RestMethod`(`irm`)、`curl`、`wget`、`Remove-Item`(`rm`,`del`,`ri`)、`Out-File`、`Set-Content`(`sc`)、`Add-Content`(`ac`)、`New-Item`(`ni`)、`Copy-Item`(`cp`,`cpi`)、`Move-Item`(`mv`,`mi`)、`Rename-Item`(`ren`)、`Clear-Content`(`clc`)、`Set-Variable`(`sv`)、`New-Variable`(`nv`)、`&` 调用操作符、`. ` 点源（dot-sourcing）、`[System.`/`[Regex]` 等 .NET 类型字面量、`-EncodedCommand`、`--%`（stop-parsing）
6. **路径开头**：命令以 `.\`、`~/`、盘符 `X:\`、`/` 开头（直接执行脚本/可执行文件）

实现原则：
- 检测**不确定 → 弹窗**（保守取向）。例如引号内出现 `|`（如 `Select-String "|" file`）允许但实现复杂；一期从简：**引号内的 `|`、`;`、`&` 视为安全豁免（lexer 级拆分后逐段判定）**，若一期 lexer 做不到位则整串判危险，宁可多弹窗。
- 检测器必须是**零依赖纯函数**（放 `src/main/tools/command-allowlist.ts` 或 `src/shared/`），便于 `node --test` 直测（项目测试约束：测试环境无 Electron）。

### 3.5 匹配算法

```
输入：command: string, config: ToolSettings
1. normalize：trim、统一小写（Windows）、压缩连续空白
2. 引号感知 lexer 拆分语句段（`;`、换行、`&&`、`||` 顶层分隔）→ 得到语句段列表；任何一段判定不通过即整体不通过
3. 对每段：
   a. 危险模式扫描（3.4）→ 命中：return 'confirm'
   b. 黑名单前缀匹配（commandDenylist）→ 命中：return 'confirm'
   c. 内置只读清单匹配（首 token + 别名表）→ 命中：继续（所有段都命中才 return 'auto'）
   d. 用户白名单匹配（commandAllowlist 首 token 前缀）→ 命中：继续
   e. return 'confirm'
4. 全部段通过 → return 'auto'
```

- 前缀匹配语义：白名单条目 `git` 允许 `git status`/`git log` 等；条目 `git status` 只允许 `git status` 开头。与 Cursor/Roo 一致，条目粒度由用户控制。
- 黑名单条目同样支持前缀（`git push` 会拦住 `git push origin main`）。
- 首个 token 判定基于空格/引号边界，带引号的可执行路径（`"C:\Program Files\x.exe"`）一律不匹配白名单（判 confirm）。

### 3.6 确认弹窗扩展

`ConfirmationPanel.tsx`（src/renderer/features/confirmation/ConfirmationPanel.tsx）新增勾选项「**总是允许此命令**」（仅 `run_command` 且未命中黑名单/危险模式时显示）：

- 现状：勾选「自动运行并记住」仅对 `canAutoRun = system && risk !== 'high'` 的工具显示（tool-registry.ts:1871），写入 Agent 级 `autoExecuteTools`（工具粒度）。
- 扩展方式：`requestToolConfirmation` 的请求 payload 增加 `commandAutoAllow?: string` 字段（提取的规范化命令前缀，如 `git status`）；renderer 勾选后随确认应答回传 `commandAutoAllow`；主进程 `tool:confirm-response` handler 收到后调用 `configService` 将该前缀并入 `toolSettings.commandAllowlist` 持久化。
- 四层同步：shared/contracts.ts（`ToolConfirmationRequest`/response 类型）→ preload/index.ts → confirmation-service.ts → renderer。

### 3.7 与 run_powershell_template 的关系

`run_powershell_template`（tool-registry.ts:977-1001）的模板枚举 `['listProcesses','listServices']` 为纯只读查询，本期直接降级 `risk: 'high' → 'medium'`，使其立即被现有 Agent 级 `autoExecuteTools` 勾选机制覆盖（AgentEditor 解禁）。不纳入命令白名单体系（它不产生自由命令字符串）。

## 4. UI 设计

### 4.1 设置界面新增「工具设置」tab（用户明确要求）

现状：设置弹窗 tab 枚举 `'agents' | 'skills' | 'mcp' | 'mail' | 'workflow' | 'general' | 'about'`（src/renderer/lib/types/app-shell.ts:8），general 的 SettingsPanel 单页塞了 API Key、工具路径（allowedPaths/searchRoots/draftDirectory）、轮数/超时、关闭行为等全部配置。

改动：
1. `app-shell.ts` 的 Tab 联合类型增加 `'tools'`，标签「工具设置」。
2. 新建 `src/renderer/features/settings/ToolsSettingsPanel.tsx`：
   - **命令自动执行**区块：
     - 说明文案：白名单内命令前缀将自动执行、不再弹确认；黑名单优先级最高；含管道/重定向/子表达式等复合语法的命令始终弹窗。
     - 白名单编辑器：多行文本（每行一条前缀），风格沿用 allowedPaths 的 `splitMultilineInput` 交互；行内展示内置只读清单为只读说明（「以下命令默认放行：…」折叠展示），用户可看到基线。
     - 黑名单编辑器：同上。
     - 呈现当前生效合并视图的提示：内置清单 ∪ 用户白名单 − 黑名单。
   - **文件访问路径**区块：将 allowedPaths / searchRoots / draftDirectory 从 SettingsPanel 迁移至此（设置项归口「工具设置」；SettingsPanel 移除这三个字段并保留其余）。
3. `App.tsx` renderContent switch（@745-800）增加 `tools → ToolsSettingsPanel` 分支。
4. 表单状态链路四件套同步：`config-form.ts`（initialConfigForm）、`settings-model.ts`（normalizeConfigForm）、`use-settings-state.ts`（saveConfigWithValues payload 拆分到新 tab 提交）、SettingsPanel/ToolsSettingsPanel UI。
5. 弹窗内的确认卡勾选写入的白名单条目，与本 tab 编辑的是同一份 `toolSettings.commandAllowlist`（下次打开设置即可见，无需额外同步通道——SettingsDialogShell 打开时已有 getConfig 重拉逻辑，use-settings-state.ts:51-59）。

### 4.2 确认卡 UI

ConfirmationPanel 在 `canAutoRun` 之外新增「总是允许此命令」复选框 + 一行小字说明「将 `git status` 加入命令白名单（全局设置）」。两个勾选互斥显示（命令类显示本项，其他 medium 工具显示原项）。

## 5. 判定接入点（主进程）

tool-registry.ts `executeToolCall`（@1688-1958）：

1. 在 `autoApproved` 判定（@1840-1853）中为 run_command 增加旁路：`options.approvalMode !== 'unattended-safe' && !options?.workflowMeta` 时，调用 `evaluateCommandAutoRun(command, toolSettings)`（纯函数）：
   - 返回 `'auto'` → 该次调用并入 autoApproved，跳过弹窗；审计日志记录 `autoRun: 'command-allowlist'` 与命中原因，便于追溯。
   - 返回 `'confirm'` → 走原弹窗流程，且 `canAutoRun` 维持 false 时仍可通过 3.6 的 commandAutoAllow 勾选写入白名单（下次生效）。
2. run_command 注册项增加 `buildConfirmation`：summary 为规范化命令，detail 为 shell/工作目录与命中原因（黑名单/危险模式/未匹配清单），并携带 `commandAutoAllow` 建议前缀（未命中黑名单与危险模式时 = 首个 token + 子命令原样前缀）。
3. 黑名单/危险模式命中的弹窗**不显示**「总是允许此命令」勾选（payload 字段 `commandAutoAllow` 置空即可，renderer 按 falsy 隐藏）。

## 6. 受影响文件清单

| 文件 | 改动 |
|---|---|
| src/shared/config.ts | ToolSettings 增 commandAllowlist/commandDenylist；sanitize 扩展 |
| src/main/tools/command-allowlist.ts（新建） | 零依赖纯函数：内置只读清单常量、危险模式检测、引号感知 lexer、evaluateCommandAutoRun、提取命令前缀 |
| src/main/tools/command-allowlist.test.ts（新建） | 纯函数单测（node --test） |
| src/main/tools/tool-registry.ts | executeToolCall 接入判定；run_command 注册项加 buildConfirmation |
| src/main/tools/tool-registry.ts 或 system-tools.ts | run_powershell_template risk 降级 medium |
| src/main/tools/confirmation-service.ts | 请求/应答扩展 commandAutoAllow；写入 config（经 config-service） |
| src/main/core/config-service.ts | 无结构性改动（sanitizeConfig 已覆盖）；如需 helper（appendCommandAllowlist）则加在此 |
| src/shared/contracts.ts | ToolConfirmationRequest/ConfirmationResponse 类型扩展 |
| src/preload/index.ts | 应答通道参数透传 |
| src/renderer/features/confirmation/ConfirmationPanel.tsx | 「总是允许此命令」勾选与文案 |
| src/renderer/lib/hooks/use-chat-session.ts | handleToolConfirmation 透传 commandAutoAllow |
| src/renderer/lib/types/app-shell.ts | Tab 类型加 'tools' |
| src/renderer/features/settings/ToolsSettingsPanel.tsx（新建） | 工具设置 tab：命令白/黑名单 + 文件路径三字段迁移 |
| src/renderer/features/settings/SettingsPanel.tsx | 移除 allowedPaths/searchRoots/draftDirectory 区块 |
| src/renderer/App.tsx | tab 分发 + 面板接线 |
| src/renderer/config-form.ts | initialConfigForm 增字段 |
| src/renderer/features/settings/settings-model.ts | normalizeConfigForm 增字段 |
| src/renderer/lib/hooks/use-settings-state.ts | saveConfigWithValues payload |
| package.json | test 脚本两处列表登记 command-allowlist.test.ts |

## 7. 边界与例外

- **无人值守链路不放开**：定时任务下 run_command 维持拒绝（auto-execute.ts:43-52 原逻辑），白名单只影响交互式会话。
- **workflow 链路不放开**：带 workflowMeta 的调用维持原 requireConfirmation 策略。
- **大小写**：Windows 存储与匹配均小写化；未来跨平台时按平台分支（darwin/linux 区分大小写）。
- **引号路径**：带引号的可执行路径不参与白名单匹配，一律弹窗。
- **多语句**：任一语句段判定 confirm，整体 confirm；auto 需全部段通过。
- **白名单被清空**：行为回到纯内置清单 + 弹窗，无异常路径。
- **向后兼容**：老 config.json 无新字段 → sanitize 给 undefined → 仅内置清单生效，无迁移脚本。
- **测试约束**：command-allowlist.ts 必须零依赖（不 import Electron/config-service），测试文件登记进 package.json test 脚本的 esbuild 列表与 node --test 列表两处。
- **验证**：`npm run typecheck` + `npm test`（项目规则）。

## 8. 预期结果

- `ls`、`cat xxx`、`git status`、`Get-Process` 等只读命令：不再弹窗，直接执行。
- `Remove-Item`、`npm install`、`curl xxx | sh` 等写/网络/复合命令：仍弹窗；用户可在弹窗勾选「总是允许此命令」逐步积累白名单，或在设置 tab 批量编辑。
- 用户黑名单命中（如 `rm`）：永远弹窗且不可勾选自动执行。
- 设置界面出现独立「工具设置」tab，命令白/黑名单与文件访问路径统一管理。
