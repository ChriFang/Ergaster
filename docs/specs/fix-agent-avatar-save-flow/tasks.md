# 智能体头像保存与返回流程根因修复任务计划

- [x] Task 1: 类型化智能体保存结果
    - 1.1: 调整 `AgentProfileOperationResult.data` 类型
    - 1.2: 确认创建、更新、删除返回值兼容新类型
    - 1.3: 保持 IPC handler 和 preload 调用方式不变

- [x] Task 2: 保存成功后直接同步智能体列表
    - 2.1: 在 `AgentsPanel.tsx` 中新增 detail 转 list item helper
    - 2.2: 新增智能体列表 upsert 和排序 helper
    - 2.3: 创建成功后使用返回 detail 插入本地列表
    - 2.4: 编辑成功后使用返回 detail 替换本地列表项
    - 2.5: 同步调用 `onAgentsChanged` 更新主侧栏列表

- [x] Task 3: 稳定保存后返回管理列表流程
    - 3.1: 保存失败时继续抛错给编辑器显示错误
    - 3.2: 保存成功后立即清空 `editingAgent` 和 `isCreating`
    - 3.3: 将保存后的资源刷新改为补偿流程
    - 3.4: 避免刷新异常阻断返回智能体管理列表

- [x] Task 4: 保持编辑器头像选择提交最新值
    - 4.1: 保留 `avatarColorRef` 与 state 同步逻辑
    - 4.2: 确认色块点击更新 ref 和 state
    - 4.3: 确认保存 payload 使用最新头像颜色
    - 4.4: 避免新增重复返回列表逻辑

- [x] Task 5: 验证修复并生成总结
    - 5.1: 检查 `tasks.md` 中已完成任务状态
    - 5.2: 运行 `npm run typecheck`
    - 5.3: 运行 `npm run build`
    - 5.4: 生成 `.comate/specs/fix-agent-avatar-save-flow/summary.md`
