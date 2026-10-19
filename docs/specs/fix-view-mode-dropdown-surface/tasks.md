# 修复模式下拉列表展开后灰底视觉问题任务计划
- [✓] Task 1: 用自定义菜单替换原生模式 select
    - 1.1: 重写 `ViewModeSwitcher`，将原生 `select/option` 替换为按钮触发的自定义菜单结构
    - 1.2: 保留 `chat`、`debate`、`deep_research` 三个模式选项与现有 `onChange` 调用方式
    - 1.3: 在组件内维护展开/关闭状态，并在选择选项后自动关闭菜单

- [✓] Task 2: 补齐自定义下拉的关闭与可用性行为
    - 2.1: 实现点击组件外部关闭菜单
    - 2.2: 实现 `Escape` 关闭菜单与触发按钮的基础键盘可达性
    - 2.3: 保持 `disabled` 状态下不可展开、不可切换

- [✓] Task 3: 调整深色视觉样式
    - 3.1: 删除或停用 `.view-mode-select` 原生 select 样式依赖
    - 3.2: 新增 trigger、menu、option、选中态、hover、focus-visible、disabled 的深色样式
    - 3.3: 确认菜单层级、定位和 header 对齐满足聊天视图与 workflow 视图

- [✓] Task 4: 验证修复并归档结果
    - 4.1: 运行 TypeScript 类型检查
    - 4.2: 检查代码中不再使用原生 `select` 渲染模式切换
    - 4.3: 记录修复范围、验证结果与未改动项到 `summary.md`
