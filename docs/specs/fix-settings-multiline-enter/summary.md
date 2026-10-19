# 修复通用设置多行路径输入 Enter 无法换行总结

## 完成情况
已修复通用设置中“允许打开的路径”和“搜索目录”两个多行输入框按 Enter 无法保留换行的问题。

## 问题原因
这两个控件本身是 `textarea`，没有被键盘事件拦截。原问题来自输入期间的受控值归一化：输入内容会立即经过 `splitMultilineInput` 拆分、去首尾空白并过滤空行，再由数组 `join('\n')` 回显，导致末尾换行和空行被立即吞掉。

## 实际改动
- 修改 `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-settings-state.ts`
  - 新增 `allowedPathsText` 与 `searchRootsText` 文本编辑态
  - 通过包装后的 `setFormValues` 在配置初始化或保存成功后同步多行文本
  - 保存时使用 `splitMultilineInput(allowedPathsText)` 与 `splitMultilineInput(searchRootsText)` 生成配置数组
  - 保存失败时不会清空当前编辑中的多行文本
- 修改 `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - `onAllowedPathsChange` 改为直接调用 `setAllowedPathsText`
  - `onSearchRootsChange` 改为直接调用 `setSearchRootsText`
  - 移除 `App.tsx` 中不再需要的 `splitMultilineInput` 导入

## 验证结果
- 已运行 `npm run typecheck`，结果通过
- 已确认输入链路中不再即时调用 `splitMultilineInput`
- 已确认归一化仍发生在保存阶段，配置结构继续保持为 `string[]`

## 未改动项
- 未改动 `SettingsPanel` 的 textarea 结构和文案
- 未改动 `open_path` / `search_files` 的主进程路径读取逻辑
- 未改动 API Key、API Base URL、最大工具调用轮数、兼容 OneAPI、草稿目录等其他设置项行为
