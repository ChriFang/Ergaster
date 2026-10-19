# 智能体保存复用取消路径与头像颜色保存修复任务计划

- [x] Task 1: 让保存成功复用取消返回路径
    - 1.1: 调整 `AgentEditor.tsx` 的 `handleSave()` 成功路径
    - 1.2: 在 `await onSave()` 成功后调用 `onCancel()`
    - 1.3: 保持保存失败时停留编辑器并展示错误
    - 1.4: 保持取消按钮原有逻辑不变

- [x] Task 2: 简化头像颜色提交状态源
    - 2.1: 从 `AgentEditor.tsx` 移除 `useRef` 引入
    - 2.2: 删除 `avatarColorRef` 和 `handleAvatarColorChange()`
    - 2.3: 保存 payload 改为直接提交 `avatarColor` state
    - 2.4: 色块点击改为直接 `setAvatarColor(colorItem.value)`

- [x] Task 3: 保留并修正保存结果同步列表逻辑
    - 3.1: 保留 `AgentsPanel.tsx` 中保存返回 detail 转列表项逻辑
    - 3.2: 保留 upsert 排序并同步 `onAgentsChanged`
    - 3.3: 修复 `AgentsPanel.tsx` 中当前乱码的中文提示字符串
    - 3.4: 保留保存后后台刷新补偿流程

- [x] Task 4: 验证修复并生成总结
    - 4.1: 检查 `tasks.md` 中已完成任务状态
    - 4.2: 运行 `npm run typecheck`
    - 4.3: 运行 `npm run build`
    - 4.4: 生成 `.comate/specs/fix-agent-save-use-cancel-path/summary.md`
