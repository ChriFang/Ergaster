# 修复模型选择列表展开后灰底视觉问题任务计划
- [✓] Task 1: 用自定义菜单替换模型原生 select
    - 1.1: 重写 `Composer` 中模型选择区域，将原生 `select/option` 替换为按钮触发的自定义菜单结构
    - 1.2: 保留 `availableModels`、`selectedModel`、`selectValue` 的现有回退语义
    - 1.3: 选择模型后继续调用现有 `onModelChange(model)` 并自动关闭菜单

- [✓] Task 2: 补齐模型下拉的关闭与状态行为
    - 2.1: 实现点击组件外部关闭菜单
    - 2.2: 实现 `Escape` 关闭菜单与触发按钮的基础键盘可达性
    - 2.3: 保持 `isRunning`、无模型、加载中场景下的禁用语义与标题提示

- [✓] Task 3: 调整模型下拉的深色视觉样式
    - 3.1: 删除或停用 `.composer-model-select` 原生 select 样式依赖
    - 3.2: 新增 trigger、menu、option、选中态、hover、focus-visible、disabled 的深色样式
    - 3.3: 保持刷新按钮、加载旋转效果和输入区布局稳定

- [✓] Task 4: 验证修复并归档结果
    - 4.1: 运行 TypeScript 类型检查
    - 4.2: 检查 `Composer` 中不再使用原生 `select` 渲染模型列表
    - 4.3: 记录修复范围、验证结果与未改动项到 `summary.md`
