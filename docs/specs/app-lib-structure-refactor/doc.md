# App 与 renderer lib 结构拆分设计

## 背景与目标
当前 `src/renderer/App.tsx` 同时承担了以下职责：
- 顶层页面装配
- renderer 侧应用状态管理
- Electron preload API 调用编排
- Agent 流式消息处理
- 设置保存与表单同步
- 会话菜单、上下文菜单、滚动副作用等 UI 交互管理

这导致 `App.tsx` 文件过长、状态与副作用耦合度较高，后续继续扩展会增加维护成本。当前目标是在**不改变现有执行逻辑与 IPC 语义**的前提下，对 `App.tsx` 进行结构化拆分，并新增 `src/renderer/lib` 目录承载 renderer 内部通用状态、数据、工具与类型。

本次重构参考 `agent-ui` 项目“页面编排 + 逻辑下沉”的方向，但不会机械照搬其目录结构，也不会引入新的状态管理库。

## 重构原则
- 保持 `window.desktopApp` 为 renderer 与主进程之间的清晰边界，不改变 IPC 调用方式
- 不修改 Agent 执行、流式消息拼接、工具确认、配置保存、输入历史持久化等既有语义
- 优先提取纯函数、局部状态 hook、常量与本地类型，避免过度抽象
- `App.tsx` 保留页面编排职责，减少业务细节与副作用实现细节
- 不引入 Zustand、Redux、Tailwind 等额外依赖

## 目标目录结构
计划新增并使用以下目录结构：

```text
src/renderer/
  lib/
    constants/
      app-constants.ts
    desktop/
      desktop-app-client.ts
    hooks/
      use-app-bootstrap.ts
      use-chat-session.ts
      use-composer-state.ts
      use-context-menu.ts
      use-settings-state.ts
      use-console-menu.ts
    types/
      app-shell.ts
    utils/
      agent-stream.ts
      conversation.ts
```

允许根据实际编码过程微调文件名，但需要保持职责边界一致。

## 职责拆分方案

### 1. 类型下沉到 `lib/types`
将当前仅由 renderer App 使用、但不属于 shared 协议层的类型移出 `App.tsx`：
- `ContextMenuState`
- `SettingsDialogTab`
- 如有必要，补充 `SettingsDialogState`、`ConsoleMenuState` 等本地组合类型

受影响文件：
- 修改 `e:\other-code\desktop-tools\src\renderer\App.tsx`
- 新增 `e:\other-code\desktop-tools\src\renderer\lib\types\app-shell.ts`

预期结果：
- `App.tsx` 不再定义本地类型
- renderer 本地类型集中管理，便于后续 layout/hooks 复用

### 2. 纯函数下沉到 `lib/utils`
将不依赖 React 状态、只负责数据转换与判定的函数从 `App.tsx` 提取：
- `toConversationScope(agentId)`
- `matchesStreamEventAgent(event, selectedAgentId)`
- `appendAssistantStreamDelta(currentMessages, event)`
- `getLatestStreamingAssistantMessage(messages)`

建议分布：
- `conversation.ts`：会话 scope 相关函数
- `agent-stream.ts`：流式消息拼接与可见流式状态推导

受影响文件：
- 修改 `e:\other-code\desktop-tools\src\renderer\App.tsx`
- 新增 `e:\other-code\desktop-tools\src\renderer\lib\utils\conversation.ts`
- 新增 `e:\other-code\desktop-tools\src\renderer\lib\utils\agent-stream.ts`

预期结果：
- 数据逻辑可单独复用与测试
- `App.tsx` 聚焦状态装配而不是底层消息算法

### 3. preload API 访问集中到 `lib/desktop`
新增轻量封装模块，统一暴露 `window.desktopApp` 的访问入口。该封装仅用于：
- 消除 `App.tsx` 中重复的 `window.desktopApp.xxx` 直接调用
- 为 hooks 提供清晰依赖入口
- 便于未来做局部 mock 或替换，而不改变 IPC 协议

封装规则：
- 仅做直通或非常薄的一层参数封装
- 不在该层引入业务状态
- 不把错误吞掉，不改变返回值结构

示例职责：
- `getAppInfo`
- `getConfig`
- `saveConfig`
- `getAgentMessages`
- `runAgent`
- `cancelAgent`
- `resetAgent`
- `respondToolConfirmation`
- `getInputHistory` / `appendInputHistory`
- `reloadAgents` / `listAgents`
- `copyText`
- 事件订阅 API 的转发

受影响文件：
- 修改 `e:\other-code\desktop-tools\src\renderer\App.tsx`
- 新增 `e:\other-code\desktop-tools\src\renderer\lib\desktop\desktop-app-client.ts`

预期结果：
- `App.tsx` 与 hooks 不直接依赖全局对象
- Electron renderer 边界仍然清晰可见

### 4. 状态逻辑拆分到 `lib/hooks`
本次拆分的重点不是把所有 state 机械分散，而是把**高内聚、低耦合**的状态组合提取为 hooks。

#### 4.1 `useSettingsState`
负责：
- `settingsDialogState`
- `config`
- `formValues`
- `saveStatus`
- `showApiKey`
- `allowedPathsText` / `searchRootsText` / `draftDirectoryText`
- `updateToolSettings`
- `saveConfigWithValues`
- `handleSaveConfig`
- 思考模式切换保存逻辑

边界要求：
- 保留 `normalizeConfigForm` / `splitMultilineInput` 的现有行为
- `saveConfig` 的 payload 裁剪逻辑保持一致
- 失败回滚与状态文案保持现有语义

#### 4.2 `useChatSession`
负责：
- `messages`
- `runStatus`
- `isRunning`
- `confirmationRequest`
- `lastError`
- `expandedToolMessageKeys`
- `selectedAgentId`
- `agents`
- `activeStreamAgentIdRef`
- `loadConversationMessages`
- `handleAgentSelection`
- `handleRunAgent`
- `handleCancelAgent`
- `handleResetAgent`
- `handleToolConfirmation`
- `handleToggleToolMessage`
- `handleAgentsChanged`
- `visibleMessages`
- `latestStreamingAssistantMessage`
- `showRunningActivityPanel` / `showErrorActivityPanel`

边界要求：
- 流式消息过滤仍必须基于当前激活 agent id
- 发送消息前清空输入、更新历史、插入用户消息的顺序保持一致
- 错误恢复时仍从会话快照回填消息
- confirmation/running/error 面板展示判定不变

#### 4.3 `useComposerState`
负责：
- `input`
- `selectedHistoryDraft`
- `inputHistory`
- `handleHistoryClick`
- `handleInputChange`
- `handleComposerKeyDown`

边界要求：
- 输入历史去重与最多 100 条的规则保持一致
- 仅管理输入相关状态，不直接发起 agent 执行

#### 4.4 `useContextMenu`
负责：
- `contextMenuState`
- `copyText`
- `handleCopySelection`
- `handleMessageContextMenu`
- 上下文菜单显示/关闭副作用

边界要求：
- 仍依赖 `window.getSelection()` 获取选中文本
- 滚动、点击空白、Escape 时关闭菜单的行为保持不变

#### 4.5 `useConsoleMenu`
负责：
- `isMenuOpen`
- `menuRef`
- 菜单开关与点击外部关闭逻辑

边界要求：
- 不耦合 settings 内容，仅暴露开关状态与关闭动作

#### 4.6 `useAppBootstrap`
负责：
- 初始加载 `appInfo`
- 初始加载 config、messages、history、agents
- 注册 tool confirmation 与 stream 订阅
- 在顶层协调 bootstrap 生命周期

边界要求：
- 首屏加载顺序与初始数据来源保持一致
- 清理订阅逻辑保持完整

### 5. 常量提取到 `lib/constants`
适合提取的常量：
- 默认欢迎消息数组
- 控制台下拉菜单项定义
- settings tab 定义（若当前 `SettingsDialogShell` 中已有定义且无需跨文件复用，可保持原位）

受影响文件：
- 修改 `e:\other-code\desktop-tools\src\renderer\App.tsx`
- 新增 `e:\other-code\desktop-tools\src\renderer\lib\constants\app-constants.ts`

预期结果：
- 静态文案与菜单配置从主组件移出
- `App.tsx` JSX 更聚焦布局装配

## 推荐的 App 最终职责
重构后 `App.tsx` 主要保留：
- 顶层 hooks 调用与数据组装
- `SidebarPanel` / `ConsolePanel` / `SettingsDialogShell` 三个主视图组件装配
- 少量跨 hook 协调逻辑
- About 面板内容渲染（如不值得继续拆分可保留）

预期效果：
- `App.tsx` 从“巨型控制器”收敛为“页面编排器”
- 文件长度显著下降
- 各类状态副作用职责可定位、可维护、可扩展

## 影响文件清单

### 必改文件
- `e:\other-code\desktop-tools\src\renderer\App.tsx`

### 新增文件
- `e:\other-code\desktop-tools\src\renderer\lib\types\app-shell.ts`
- `e:\other-code\desktop-tools\src\renderer\lib\utils\conversation.ts`
- `e:\other-code\desktop-tools\src\renderer\lib\utils\agent-stream.ts`
- `e:\other-code\desktop-tools\src\renderer\lib\desktop\desktop-app-client.ts`
- `e:\other-code\desktop-tools\src\renderer\lib\constants\app-constants.ts`
- `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-settings-state.ts`
- `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-chat-session.ts`
- `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-composer-state.ts`
- `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-context-menu.ts`
- `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-console-menu.ts`
- `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-app-bootstrap.ts`

### 可能联动调整文件
- `e:\other-code\desktop-tools\src\renderer\features\layout\SettingsDialogShell.tsx`
  - 若 settings tab 类型需要复用，则改为从 `lib/types` 导入
- `e:\other-code\desktop-tools\src\renderer\features\layout\ConsolePanel.tsx`
  - 若 header actions 或上下文菜单类型需要微调，则仅做类型层调整

## 数据流说明

### 会话执行流
1. 用户在 Composer 中输入 prompt
2. `useComposerState` 管理输入内容与历史选择态
3. 提交后由 `useChatSession` 执行运行逻辑
4. `desktop-app-client` 转发到 `window.desktopApp.runAgent`
5. 运行期间 stream 事件经 `useAppBootstrap` 订阅后进入 `useChatSession`
6. `agent-stream.ts` 负责拼接 assistant 增量消息
7. `App.tsx` 将最终状态传递给 `ConsolePanel`

### 配置保存流
1. `SettingsPanel` 修改 `formValues`
2. `useSettingsState` 维护表单值与 tool settings 文本映射
3. 保存时生成与当前实现一致的 payload
4. `desktop-app-client.saveConfig` 调用 preload API
5. 保存结果回写 `config` 与 `formValues`

### 右键复制流
1. `MessageList` 触发 context menu 事件
2. `useContextMenu` 读取当前选中文本
3. 若用户执行复制，则调用 `desktop-app-client.copyText`
4. 结果通过运行状态文案反馈给控制台区域

## 边界条件与异常处理
- 空输入仍禁止提交，并显示现有提示文案
- 流式事件若不属于当前激活 agent，仍必须忽略
- stream 事件若缺少 `streamMessageId` 或无增量内容，仍必须忽略
- `copyText` 若内容为空，仍显示“没有可复制的内容。”
- 保存配置时若 API key 为空字符串，仍不覆盖已有值
- 思考模式切换失败时，仍需回滚 UI 状态并显示失败提示
- 当当前选中的 agent 被删除时，仍需回退到全局会话
- bootstrap 与事件订阅在组件卸载时必须完整清理

## 验证要求
实现完成后至少执行：
- `npm run typecheck`
- `npm run build`

并重点检查：
- 发送消息 / 取消执行 / 重置会话
- 流式推理与最终回答展示
- 工具确认弹层流程
- 输入历史点击回填
- 设置保存与思考模式即时切换
- 智能体切换与会话隔离

## 预期收益
- `App.tsx` 可读性显著提升
- renderer 侧逻辑分层更清晰
- 后续新增功能时可优先落在 `lib/hooks` 或 `lib/utils`，减少主组件继续膨胀
- 保持现有运行语义不变，降低继续演进 UI 的成本
