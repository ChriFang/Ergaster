# 智能体侧边栏闪烁修复设计

## 背景
在最近一次 `App.tsx` 与 `renderer/lib` 拆分后，左侧边栏中的智能体列表出现持续闪烁。根据当前实现分析，闪烁并不是 `SidebarPanel` 自身渲染逻辑异常，而是上游 `agents` 状态被重复刷新导致列表不断重新渲染。

## 根因分析
当前问题集中在 `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-app-bootstrap.ts`。

### 现象链路
- `useAppBootstrap` 内部使用 `useEffect` 进行首屏初始化与事件订阅
- 该 effect 依赖包含：
  - `loadConversationMessages`
  - `applyStreamDelta`
  - `normalizeConfigForm`
  - 多个 setter / callback 引用
- 其中 `loadConversationMessages` 与 `applyStreamDelta` 当前在 `useChatSession` 中是普通函数，每次渲染都会生成新引用
- 当消息流、运行状态或其它状态更新导致 `App` 重渲染时，这些函数引用变化会让 `useAppBootstrap` effect 再次执行
- effect 再次执行后会重新触发：
  - `desktopAppClient.reloadAgents()`
  - `desktopAppClient.listAgents()`
  - `setAgents(...)`
- 因此左侧智能体列表被反复刷新，表现为持续闪烁

对应位置：
- `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-app-bootstrap.ts`
- `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-chat-session.ts`
- `e:\other-code\desktop-tools\src\renderer\App.tsx`

## 修复目标
- 保证 bootstrap 初始化只在组件挂载时执行一次，或只在真正需要时执行
- 保证 tool confirmation / stream 订阅不会因为普通渲染而反复注册
- 保持现有执行逻辑、IPC 语义、消息流拼接、智能体切换、工具确认、配置加载行为不变
- 修复侧边栏智能体列表闪烁问题，不引入新的状态库或额外依赖

## 技术方案

### 1. 收敛 `useAppBootstrap` 的 effect 触发条件
将 `useAppBootstrap` 从“依赖外部不稳定函数引用的 effect”调整为“稳定初始化 effect + 稳定事件桥接”的结构。

推荐实现方式：
- 初始化加载（appInfo/config/messages/history/agents）使用一次性 effect
- stream / tool confirmation 订阅逻辑单独管理
- 对于订阅内部依赖的动态函数，使用 `ref` 保存最新实现，避免为了拿到最新逻辑而重跑 effect

预期效果：
- `reloadAgents` 不再随着普通重渲染反复触发
- 左侧列表停止闪烁

### 2. 稳定 `useChatSession` 暴露给 bootstrap 的关键回调
对以下函数使用 `useCallback` 稳定引用：
- `loadConversationMessages`
- `handleAgentSelection`
- `applyStreamDelta`
- 如有必要，也可对 `handleToggleToolMessage`、`handleToolConfirmation` 做同类处理，但不是本次问题的核心

边界要求：
- 不改变原有消息更新顺序
- 不改变 active agent stream 过滤逻辑
- 不改变错误恢复、取消执行、会话重置行为

### 3. 必要时在 `useAppBootstrap` 中使用最新函数 ref
如果初始化 / 订阅仍需要访问动态回调，则在 `useAppBootstrap` 中维护：
- `applyStreamDeltaRef`
- `loadConversationMessagesRef`
- 或更小粒度的 callback ref

这样可实现：
- 订阅只注册一次
- 事件触发时仍调用最新版本逻辑

### 4. 保持 `SidebarPanel` 无需功能改动
`SidebarPanel` 当前仅根据 props 渲染列表：
- `agents`
- `selectedAgentId`

因此本次修复不应从 `SidebarPanel` 入手，也不需要额外引入 `memo` 来掩盖问题。根因在 bootstrap 重跑，不在显示层。

## 影响文件

### 必改文件
- `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-app-bootstrap.ts`
- `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-chat-session.ts`

### 可能联动文件
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - 若 bootstrap 参数或 hook 返回值需要微调

## 数据流与行为保持说明

### 初始化加载流
1. App 挂载
2. `useAppBootstrap` 触发一次初始化
3. 加载 appInfo、config、messages、inputHistory、agents
4. 数据写入现有状态容器
5. `SidebarPanel` 接收稳定的 `agents` 数据

### 流式事件处理流
1. Agent 运行过程中主进程推送 stream event
2. 已注册的稳定订阅接收事件
3. 通过当前 active agent id 过滤非当前会话事件
4. 调用最新 `applyStreamDelta` 逻辑拼接消息
5. 仅消息区按预期更新，不触发 agent 列表重新加载

## 边界条件
- 首屏仍必须正常加载智能体列表
- 智能体 CRUD 后通过现有 `handleAgentsChanged` 仍可刷新列表
- 流式输出期间智能体列表不应重复请求刷新
- 工具确认事件订阅仍需正常工作
- 组件卸载时必须仍然正确清理订阅

## 验证要求
实现后至少验证：
- 启动页面后智能体列表只加载一次，无持续闪烁
- 发送消息并触发流式输出时，左侧智能体列表保持稳定
- 创建/删除智能体后，列表仍能正确更新
- `npm run typecheck`
- `npm run build`

## 预期结果
- 修复左侧智能体列表闪烁
- 避免 bootstrap effect 因依赖抖动反复执行
- 保持当前 UI 拆分后的结构，同时让 hook 生命周期更稳定
