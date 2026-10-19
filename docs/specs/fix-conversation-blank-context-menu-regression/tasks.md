# 修复会话区空白处右键菜单在对话后失效的任务拆解
- [✓] Task 1: 收窄空白区右键判定范围
    - 1.1: 修改 `src/renderer/lib/hooks/use-context-menu.ts` 的 `handleConversationBlankContextMenu`
    - 1.2: 移除 `.message-row` 的 `closest(...)` 过滤
    - 1.3: 保留 `.message-card-shell` 与 `.message-context-menu` 过滤
    - 1.4: 保持已有文本选中时优先走消息复制菜单逻辑

- [✓] Task 2: 复核上下文菜单接入点与联动影响
    - 2.1: 确认 `ConsolePanel` 的会话区 `onContextMenu` 绑定无需调整
    - 2.2: 确认 `MessageContextMenu` 的“复制 / 重置会话”分支无需改动
    - 2.3: 确认此次修复不改动会话重置调用链与作用域

- [✓] Task 3: 完成验证并收尾
    - 3.1: 执行 TypeScript 类型检查
    - 3.2: 执行构建验证
    - 3.3: 补充本次修复总结到 `summary.md`
