# 精简系统执行中卡片总结

## 完成内容

- 已精简会话区执行中卡片。
- 执行中卡片不再展示冗余文案：
  - 移除了 `系统` 标题。
  - 移除了 `执行中...` 状态徽标。
  - 移除了 `正在处理当前请求，请稍候...` 正文。
- 执行中卡片现在只展示：
  - 一个 `Bot` 头像。
  - `.` / `..` / `...` 交替显示的动态点序列。
- 保留了原有 500ms 点序列切换逻辑。
- 为动态点序列增加了 `aria-label="系统正在执行"`。
- 错误卡片保持原有结构和行为不变。

## 修改文件

- `e:\other-code\desktop-tools\src\renderer\features\activity\ActivityPanel.tsx`
  - 引入 `Bot` 图标。
  - 将执行中分支改为头像加动态点的紧凑结构。
  - 保留错误分支不变。

- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 新增 `.activity-panel-running-compact`。
  - 新增 `.activity-running-row`。
  - 新增 `.activity-running-avatar`。
  - 新增 `.activity-running-dots`。
  - 新增 `.console-inline-panel .activity-panel-running-compact` 宽度覆盖，使执行中卡片按内容收缩。

## 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过。

## 结果

当前系统执行中卡片更紧凑，只保留头像与 `.` / `..` / `...` 动态反馈，减少了重复文字占用，同时保持执行状态可感知。
