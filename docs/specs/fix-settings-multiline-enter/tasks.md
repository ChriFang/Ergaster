# 修复通用设置多行路径输入 Enter 无法换行任务计划
- [✓] Task 1: 分离多行路径输入的编辑态
    - 1.1: 在 `useSettingsState` 中新增 `allowedPathsText` 与 `searchRootsText` 的 `useState` 编辑态
    - 1.2: 在配置加载或保存成功规范化后，用配置数组刷新多行文本编辑态
    - 1.3: 保留 `draftDirectoryText` 与其他设置字段现有行为不变

- [✓] Task 2: 调整通用设置 textarea 的变更链路
    - 2.1: 修改 `App.tsx` 中传给 `SettingsPanel` 的 `onAllowedPathsChange`，改为直接更新 `allowedPathsText`
    - 2.2: 修改 `App.tsx` 中传给 `SettingsPanel` 的 `onSearchRootsChange`，改为直接更新 `searchRootsText`
    - 2.3: 移除 `App.tsx` 中不再需要的 `splitMultilineInput` 导入或引用

- [✓] Task 3: 保存时归一化多行路径配置
    - 3.1: 在 `useSettingsState.saveConfigWithValues` 中使用 `splitMultilineInput(allowedPathsText)` 生成 `allowedPaths`
    - 3.2: 在 `useSettingsState.saveConfigWithValues` 中使用 `splitMultilineInput(searchRootsText)` 生成 `searchRoots`
    - 3.3: 确认保存失败时不清空用户当前编辑中的多行文本

- [✓] Task 4: 验证修复并归档结果
    - 4.1: 运行 TypeScript 类型检查
    - 4.2: 检查目标代码中 textarea 输入期间不再即时过滤换行
    - 4.3: 记录修复范围、验证结果与未改动项到 `summary.md`
