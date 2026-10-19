# 去掉会话区顶部标题右侧 agent 字段任务计划
- [x] Task 1: 移除聊天会话头部的 agent 元信息块
    - 1.1: 修改 `ChatConsoleView`，删除 `console-agent-meta` JSX 节点
    - 1.2: 保留 `selectedAgent` 标题、状态、描述与默认模式分支不变
    - 1.3: 确认聊天模式头部不再渲染 `agent` 与 `selectedAgent.id`

- [x] Task 2: 清理仅供该字段使用的样式定义
    - 2.1: 删除 `styles.css` 中 `.console-agent-meta` 样式块
    - 2.2: 确认不会影响其他 header 布局规则

- [x] Task 3: 完成定点验证与结果归档
    - 3.1: 检查目标文件中不再存在顶部右侧 `agent xxx` 渲染代码
    - 3.2: 记录本次改动范围、结果与未变更项到 `summary.md`
