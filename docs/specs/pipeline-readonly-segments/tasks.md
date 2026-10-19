# 管道只读段放行 - 任务计划

- [✓] Task 1: 判定引擎支持管道拆段（src/main/tools/command-allowlist.ts）
    - 1.1: 新增 splitPipeline(segment)：顶层 `|` 拆子段（引号/脚本块内不拆；`|` 后紧跟 `|` 视为语句分隔残留一并处理）
    - 1.2: scanSegmentDanger 移除顶层 `|` 判死；`&` 判死与文本级/首 token/路径检查保留
    - 1.3: 脚本块条件判定：仅 tolerated cmdlet 允许携带 `{...}`；提取块内容做文本级危险检查 + 逐 token 高危命令检查；嵌套 `{` 判危险；非 tolerated 出现 `{` 判危险
    - 1.4: evaluateCommandAutoRun 每语句段按管道子段逐段重跑 scanSegmentDanger + 黑名单/内置清单/用户白名单判定，全部通过才 auto
- [✓] Task 2: 单测更新（src/main/tools/command-allowlist.test.ts）
    - 2.1: 调整旧断言：`Get-Process | Get-Member`、`ls | foreach { $_ }`、`Get-Process | Where-Object { $_.Name }` 改为 auto
    - 2.2: 新增只读管道 auto 用例（cat|Select-String、git log|Select-Object、gci|sort、白名单段入管道）
    - 2.3: 新增 confirm 用例（右段 iex/Out-File/rm/未知名单外命令、`echo 'rm x' | iex`、非 tolerated 脚本块、块内高危、嵌套块、`2>&1`）
    - 2.4: 保留引号内 `|` 不算管道的既有用例并确认仍通过
- [✓] Task 3: 全量验证
    - 3.1: npm run typecheck 通过
    - 3.2: npm test 通过（406/406）
    - 3.3: 手动冒烟留待应用内验证（`Get-Process | sort` 免确认；`ls | iex` 弹窗）
