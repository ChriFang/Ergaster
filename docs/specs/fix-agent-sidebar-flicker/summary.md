# 智能体侧边栏闪烁修复总结

## 问题原因
本次闪烁不是 `SidebarPanel` 自身渲染错误，而是 `useAppBootstrap` 的 effect 依赖包含不稳定函数引用，导致 effect 在普通重渲染过程中反复执行。每次重跑都会重新执行 `reloadAgents + listAgents + setAgents`，从而让左侧智能体列表持续刷新，表现为闪烁。

## 实施改动
- 重构 `src/renderer/lib/hooks/use-app-bootstrap.ts`
  - 将初始化加载与事件订阅拆分为两个独立 effect
  - 使用 `ref` 保存最新的 `loadConversationMessages`、`applyStreamDelta`、`normalizeConfigForm`，避免为了拿到最新逻辑而重复执行初始化或重复注册订阅
  - 让 appInfo/config/messages/history/agents 的初始化加载只在挂载阶段执行一次
- 调整 `src/renderer/lib/hooks/use-chat-session.ts`
  - 使用 `useCallback` 稳定 `loadConversationMessages`
  - 使用 `useCallback` 稳定 `handleAgentSelection`
  - 使用 `useCallback` 稳定 `applyStreamDelta`
  - 同时将 `handleToggleToolMessage` 也收敛为稳定引用

## 修复结果
- 流式消息输出期间不会再反复触发 agent 列表刷新
- 左侧智能体列表恢复稳定，不再因为 bootstrap 重跑而持续闪烁
- 保持了原有的：
  - 智能体首屏加载
  - 会话切换
  - 流式消息拼接
  - 工具确认订阅
  - 输入历史与配置加载行为

## 验证
已执行并通过：
- `npm run typecheck`
- `npm run build`
