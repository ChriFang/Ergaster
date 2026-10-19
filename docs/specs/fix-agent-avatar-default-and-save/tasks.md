# 默认模式头像与头像颜色保存修复任务计划

- [✓] Task 1: 补齐默认模式浅蓝色头像
    - 1.1: 调整 `SidebarPanel.tsx` 中默认模式按钮结构
    - 1.2: 复用带头像侧栏列表项布局
    - 1.3: 为默认模式头像显示固定“默”字
    - 1.4: 在 `styles.css` 中新增默认浅蓝色头像样式

- [✓] Task 2: 修复头像色块保存取值
    - 2.1: 在 `AgentEditor.tsx` 中引入 `useRef`
    - 2.2: 增加头像颜色 ref 并与 state 同步
    - 2.3: 将色块点击逻辑改为同时更新 ref 和 state
    - 2.4: 保存 payload 使用 ref 中的最新头像颜色

- [✓] Task 3: 确认保存成功后返回智能体管理列表
    - 3.1: 检查 `AgentsPanel.tsx` 保存成功路径
    - 3.2: 确认创建和编辑成功后都会清空 `editingAgent`
    - 3.3: 确认保存失败时仍停留编辑界面并显示错误
    - 3.4: 避免改变智能体数据结构和 IPC 接口

- [✓] Task 4: 验证修复并生成总结
    - 4.1: 检查 `tasks.md` 中已完成任务状态
    - 4.2: 运行 `npm run typecheck`
    - 4.3: 运行 `npm run build`
    - 4.4: 生成 `.comate/specs/fix-agent-avatar-default-and-save/summary.md`
