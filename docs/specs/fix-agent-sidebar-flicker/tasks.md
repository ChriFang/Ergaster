# 智能体侧边栏闪烁修复任务计划
- [x] Task 1: 稳定 bootstrap 生命周期与初始化加载逻辑
    - 1.1: 重构 `use-app-bootstrap.ts`，将首屏初始化加载与事件订阅拆分为稳定的 effect
    - 1.2: 避免 `reloadAgents` / `listAgents` 因普通渲染重复执行
    - 1.3: 在不改变现有初始化语义的前提下，保留 appInfo、config、messages、history、agents 的首屏加载逻辑
    - 1.4: 保持 tool confirmation 与 stream 订阅的注册/清理完整

- [x] Task 2: 稳定 chat session 对外暴露的关键回调引用
    - 2.1: 使用 `useCallback` 收敛 `loadConversationMessages` 的引用稳定性
    - 2.2: 使用 `useCallback` 收敛 `handleAgentSelection` 与 `applyStreamDelta` 的引用稳定性
    - 2.3: 确保回调稳定后不改变消息拼接、agent 过滤、错误恢复与会话切换语义

- [x] Task 3: 接入修复并完成验证
    - 3.1: 在 `App.tsx` 中适配更新后的 hook 接口（如有必要）
    - 3.2: 人工检查侧边栏智能体列表在流式输出期间不再持续闪烁
    - 3.3: 执行 `npm run typecheck` 并修复类型问题
    - 3.4: 执行 `npm run build` 并确认构建通过
    - 3.5: 回写 `.comate/specs/fix-agent-sidebar-flicker/summary.md` 与任务完成状态
