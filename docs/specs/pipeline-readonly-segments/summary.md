# 管道只读段放行 - 任务总结

## 完成概览

3 个任务全部完成，`npm run typecheck` 通过，`npm test` 406/406 通过。管道命令由"顶层 `|` 一律弹窗"改为"按顶层 `|` 拆段逐段判定，全部段命中清单才自动执行"。

## 实现内容（src/main/tools/command-allowlist.ts + 单测）

1. **splitPipeline(segment)**：语句段内按顶层 `|` 拆管道子段，复用 `findTopLevelSeparator`（引号/脚本块内不拆）。
2. **scanSegmentDanger 调整**：移除顶层 `|` 直接判死；`&`（调用/后台）仍一律确认；文本级危险模式、高危首 token、dot-sourcing、路径开头检查保留。
3. **脚本块条件放开**：`{` 从无条件危险改为条件判定——仅当 `SCRIPT_BLOCK_TOLERATED_COMMANDS` 中的 cmdlet（foreach/where/select/sort 等，含管道任一子段首 token 命中）携带脚本块时允许；其余出现 `{` 仍判危险。
4. **checkScriptBlockContent**：提取每个 `{...}` 内部文本，做文本级危险检查（重定向/子表达式/.NET 字面量等）+ 块内按管道拆段逐 token 高危命令检查；嵌套 `{` 与未闭合块判危险。
5. **evaluateCommandAutoRun**：每语句段先跑段级判定（黑名单→危险模式），再拆管道子段逐段跑完整判定链（子段危险模式→内置清单→用户白名单），全部通过才 auto。
6. **修复清单缺项**：`foreach-object`/`foreach`/`%` 补入内置只读清单（原先只在 tolerated 集合，不在只读清单，导致 `ls | foreach { $_ }` 的右段无法命中）。
7. **单测**：新增只读管道 auto（含白名单段入管道、引号内 `|`）、管道右段高危/名单外 confirm、脚本块边界（非 tolerated、块内高危、嵌套块、块内重定向、`2>&1`）共 6 个测试组；`Get-Process | Get-Member` 等旧断言由 confirm 改为 auto。

## 调试记录

实现中发现块内高危命令未被判 confirm，根因是 `checkScriptBlockContent` 的主循环只有引号分支往 `inner` 追加字符，普通字符（如 `iex`）从不写入 `inner`，导致块内 token 检查形同虚设。补上 `else { inner += ch }` 分支后所有边界用例通过。

## 行为变化

| 命令 | 之前 | 现在 |
|---|---|---|
| `Get-Process \| sort`、`cat x \| Select-String "e"`、`git log \| Select-Object -First 5` | 弹窗 | 自动执行 |
| `ls \| foreach { $_ }`、`Get-Process \| Where-Object { $_.Name }` | 弹窗 | 自动执行 |
| `npm run build \| Select-String "err"`（白名单段入管道） | 弹窗 | 自动执行 |
| `ls \| iex`、`ls \| Out-File x`、`echo 'rm x' \| iex` | 弹窗 | 弹窗（不变） |
| `ls \| notepad`（名单外外部程序） | 弹窗 | 弹窗（不变） |
| `ls 2>&1`、`&` 调用、嵌套脚本块 | 弹窗 | 弹窗（不变） |

## 遗留

- 手动冒烟需在应用内验证：`Get-Process | sort` 免确认、`ls | iex` 弹窗。
- 本次改动未提交，需要时执行提交。
