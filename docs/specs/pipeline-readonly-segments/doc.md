# 管道只读段放行（pipeline-readonly-segments）

## 1. 背景与目标

现状：`command-allowlist.ts` 的 `scanSegmentDanger` 对顶层 `|` 一律判危险，导致 `Get-Process | sort`、`cat a.txt | Select-String "err"` 这类纯只读管道组合全部弹窗，是当前误弹窗的主要来源。

目标：**按顶层 `|` 拆段，每段走完整判定链；所有段都命中只读/白名单才自动执行**。语义与现有多语句（`;`、`&&`）判定对齐。

已确认决策：
- 用户白名单段允许出现在管道中（与多语句语义一致）。
- 脚本块同步放开：`SCRIPT_BLOCK_TOLERATED_COMMANDS` 中的 cmdlet 允许携带脚本块 `{...}`，块内容逐 token 判定；其余出现 `{` 仍判危险。

## 2. 判定算法变更（src/main/tools/command-allowlist.ts）

### 2.1 语句段内拆管道子段

新增 `splitPipeline(segment)`：用 `findTopLevelSeparator(segment, ['|'])` 按顶层 `|` 拆分（引号/脚本块内不拆），返回子段列表。注意 PowerShell 的 `||`（管道链错误处理）也会先命中 `|`——拆分时若 `|` 后紧跟 `|`，视作 `||` 分隔符处理（等同多语句判定里的 `||`，在 `splitStatements` 层面已拆；此处只处理段内残留）。

### 2.2 scanSegmentDanger 调整

- 移除 `containsTopLevel(segment, ['|'])` 的直接判死。
- `&` 判死保留（调用/后台操作符无只读场景）。
- 文本级危险模式、高危首 token、dot-sourcing、路径开头检查不变——这些会应用到每个管道子段。

### 2.3 脚本块内容判定

- `DANGEROUS_TEXT_PATTERNS` 中的 `/\{/` 规则改为条件化：仅当段首 token **不在** `SCRIPT_BLOCK_TOLERATED_COMMANDS` 时，`{` 判危险。
- 对 tolerated cmdlet 的段：提取 `{...}` 内部内容（脚本块感知扫描），对块内文本做：
  - 文本级危险模式检查（`$(`、反引号、重定向、`.NET` 字面量等，`{` 除外）；
  - 块内逐 token 用 `DANGEROUS_COMMANDS` 检查（token 级，不再要求块内命令必须在只读清单——`$_`、`$PSItem` 等管道变量不是命令；只要不出现高危命令/危险语法即可）。
- 块内再嵌套 `{`（嵌套脚本块）→ 判危险（保守）。

### 2.4 evaluateCommandAutoRun 流程

```
对每个语句段 segment：
  1. 命中黑名单 → confirm
  2. scanSegmentDanger(segment)（不再含 | 判死）→ confirm
  3. splitPipeline(segment) 拆子段（无 | 时即单段）
  4. 对每个子段 pipelinePart：
     a. scanSegmentDanger(pipelinePart) → confirm（段级检查在子段上重跑，保证右段高危首 token 被拦截）
     b. matchesBuiltinList(pipelinePart) → 继续
     c. matchesUserList(pipelinePart, allowlist) → 继续
     d. 否则 → confirm
全部通过 → auto
```

说明：`scanSegmentDanger` 在父段已跑过一次（拦文本级模式），在子段再跑一次是必要的——右段首 token 的 `iex`/`Out-File` 等高危检查在父段层面只查首 token 查不到。两次调用无副作用，成本可忽略。

### 2.5 extractCommandPrefix

维持现状：多语句/管道命令在未命中黑名单与危险模式时仍从首段提取建议前缀。含管道的命令若被用户确认执行，建议前缀取首段前两 token（用户可手动把管道右段命令加进白名单）。

## 3. 单测变更（src/main/tools/command-allowlist.test.ts）

调整断言：
- `Get-Process | Get-Member` → auto（原 confirm）。
- `ls | foreach { $_ }` → auto（tolerated cmdlet + 块内容安全）。
- `Get-Process | Where-Object { $_.Name }` → auto。

新增用例：
- 只读管道 auto：`cat a.txt | Select-String "err"`、`git log --oneline | Select-Object -First 5`、`Get-ChildItem | sort`。
- 用户白名单段入管道：`{ commandAllowlist: ['npm run'] }` 下 `npm run build | Select-String "err"` → auto。
- 管道右段高危 → confirm：`ls | iex`、`ls | Out-File x`、`ls | rm`、`echo 'rm x' | iex`。
- 管道右段未命中清单 → confirm：`ls | notepad`（外部程序不在清单）、`ls | some-unknown-cmd`。
- 引号内 `|` 不算管道：`Select-String "a|b" file.txt` → auto。
- 非 tolerated cmdlet 带脚本块 → confirm：`Get-Date { x }`。
- tolerated cmdlet 块内高危 → confirm：`ls | foreach { iex $_ }`。
- 嵌套脚本块 → confirm：`ls | foreach { echo { 1 } }`。
- `2>&1` 重定向仍 confirm：`ls 2>&1`。

## 4. 受影响文件

| 文件 | 改动 |
|---|---|
| src/main/tools/command-allowlist.ts | splitPipeline、scanSegmentDanger 去 `\|` 判死、脚本块条件判定与块内容检查、evaluateCommandAutoRun 管道拆段 |
| src/main/tools/command-allowlist.test.ts | 调整 3 条旧断言 + 新增 10 组用例 |

无协议、UI、配置、持久化变更。

## 5. 边界与例外

- `&`（调用/后台）仍一律确认。
- `2>&1` 等重定向仍确认（文本级重定向模式拦截）。
- 嵌套脚本块一律确认。
- 非 tolerated cmdlet 出现 `{` 一律确认。
- `||` 已在语句拆分层处理为多语句，段内不会出现。
- 黑名单命中仍最优先：任何子段命中黑名单整体 confirm。
- 验证：`npm run typecheck` + `npm test`。

## 6. 预期结果

- `Get-Process | sort`、`cat x | Select-String "e"`、`git log | Select-Object -First 5` 等只读管道自动执行。
- 管道任一段含高危命令、未命中清单、重定向、子表达式 → 弹窗，维持安全兜底。
- 脚本块行为与管道一致：tolerated cmdlet + 块内容安全 → 放行。
