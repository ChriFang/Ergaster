# agent-ui 驱动的 desktop-tools UI 深度重构设计

## 背景与目标

用户要求以 `E:\other-code\agent-ui` 这套重新设计的 UI 作为参考，对现有项目 `e:\other-code\desktop-tools` 的界面进行一次深度重构，但必须保留现有执行逻辑、IPC 边界、工具调用流程、消息流处理、审批逻辑与配置读写逻辑。

本次工作属于“表现层与交互层重构”，不是执行内核改造。重构应尽量复用现有渲染层组件、主进程 API 和共享类型，在不改变行为语义的前提下完成结构重组与视觉升级。

## 需求场景与处理逻辑

### 场景 1：主界面整体布局重构
当前应用主界面集中在 `App.tsx` 中完成侧边栏、会话面板、弹层入口和配置弹窗渲染，视觉与结构都较为扁平。

目标是参考 `agent-ui` 的三段式结构：
- 左侧 Sidebar：展示品牌、智能体列表、输入记录切换
- 主区域 Console：展示当前智能体信息、消息区、运行状态、输入区
- 设置容器 Settings Shell：统一承载智能体、Skills、MCP、通用设置、关于等管理内容

处理逻辑：
- 保持 `window.desktopApp` 的所有调用方式不变
- 保持 `selectedAgentId`、`messages`、`inputHistory`、`confirmationRequest`、`isRunning` 等状态语义不变
- 仅重构 UI 组件层次与布局方式，将 `App.tsx` 的大块 JSX 下沉到独立容器组件

### 场景 2：会话界面重构但保留消息与流式行为
当前会话区域已支持：
- assistant 流式增量渲染
- reasoning_content 与最终内容拆分
- tool 消息展开/收起
- 复制消息与选中文本复制
- 执行中/错误状态卡片
- 工具审批卡片

目标是参考 `agent-ui` 的消息层次视觉：
- 顶部显示当前智能体摘要信息
- 会话内容限制宽度，提升可读性
- assistant 的思考过程、工具调用、最终回答具有更清晰的层次
- 输入区采用更现代的一体化卡片布局

处理逻辑：
- 保留现有 `MessageList` / `message-model` 的行为模型
- 保留 reasoning 独立展示规则：当 assistant 仅产生 reasoning 而尚未开始 content 时，显示思考气泡
- 保留 tool message 展开/收起与复制机制
- 保留审批卡片和运行状态卡片在会话流中的显示时机

### 场景 3：左侧导航重构
当前左侧栏直接顺序展示“智能体”和“输入记录”两个列表。

目标是参考 `agent-ui/components/sidebar.tsx` 的分段切换方式：
- 品牌区
- tab 切换（智能体 / 输入记录）
- 内容滚动区
- 底部设置入口

处理逻辑：
- 保留点击智能体切换会话的逻辑
- 保留点击输入记录回填输入框的逻辑
- 保留“默认模式”入口
- 不改变输入记录来源和上限逻辑

### 场景 4：设置与管理界面统一重构
当前“智能体 / Skills / MCP / 设置 / 关于”通过多个 modal 分散呈现。

目标是参考 `agent-ui/components/settings-dialog.tsx` 的统一设置壳：
- 单一大弹窗容器
- 左侧导航切换不同管理面板
- 右侧滚动区域承载现有面板组件

处理逻辑：
- 优先复用现有 `AgentsPanel`、`SkillsPanel`、`McpServersPanel`、`SettingsPanel`
- 将多个布尔弹窗状态收敛成单一设置弹层状态 + 当前 tab 状态
- “关于”内容并入统一设置容器
- 不改变各面板内部真实数据加载与保存逻辑

### 场景 5：样式体系重构
当前样式集中在 `src/renderer/styles.css`，文件很大，承担全局布局、消息、弹窗、表单、列表等全部样式。

目标：
- 保留现有纯 CSS 方案，不引入 Next.js/Tailwind/shadcn 依赖
- 但参考 `agent-ui` 的视觉语言，重构为更清晰的 design token + feature 分区样式
- 在不引入新框架的前提下实现接近参考 UI 的层次与配色

处理逻辑：
- 继续使用现有 `styles.css`
- 优先新增更语义化的 class，并删除被替换的旧布局样式
- 不将样式拆成多文件，避免本次改造同时引入过多工程结构变动

## 架构与技术方案

### 总体方案
采用“保留状态与行为、重构容器与布局”的方案：

1. `App.tsx` 保留：
   - 初始化数据加载
   - 与 `window.desktopApp` 的通信
   - 运行/取消/重置/审批/保存配置的核心逻辑
   - 关键 state 与 useEffect

2. `App.tsx` 下沉 JSX 到新的渲染层容器组件，例如：
   - `AppSidebar`
   - `ConsolePanel`
   - `SettingsDialogShell`
   - `ConsoleHeader`

3. 现有 feature 组件优先保留并适配：
   - `Composer`
   - `MessageList`
   - `ActivityPanel`
   - `ConfirmationPanel`
   - `SettingsPanel`
   - `AgentsPanel`
   - `SkillsPanel`
   - `McpServersPanel`

4. 统一多个 modal 为一个设置弹层壳，内部切换 tab，而不是同时维护多个 modal 容器。

### 为什么不直接搬运 agent-ui 代码
`agent-ui` 基于：
- Next.js 16
- Tailwind v4
- Base UI / shadcn
- 内存态 store

而 `desktop-tools` 当前是：
- Electron + Vite + React 19
- 单文件全局 CSS
- `window.desktopApp` IPC 边界
- 真实运行态和审批流

因此本次不直接复制参考项目代码，而是提炼其信息架构与视觉结构：
- 三段式页面结构
- 统一设置入口
- 顶部智能体摘要
- 更清晰的消息层次
- 更聚焦的输入区布局

## 受影响文件

### 必改文件

1. `e:\other-code\desktop-tools\src\renderer\App.tsx`
- 修改类型：重构
- 影响函数：
  - `handleAgentSelection`
  - `handleRunAgent`
  - `handleCancelAgent`
  - `handleResetAgent`
  - `handleToolConfirmation`
  - `handleHistoryClick`
  - `handleInputChange`
  - `saveConfigWithValues`
- 变更重点：
  - 收敛多个 modal 状态
  - 调整主界面 JSX 结构
  - 接入新的侧边栏/控制台/设置壳组件
  - 保持所有逻辑函数与数据流不变

2. `e:\other-code\desktop-tools\src\renderer\styles.css`
- 修改类型：重构
- 影响区域：
  - `.app-shell`
  - `.sidebar*`
  - `.chat-panel*`
  - `.message*`
  - `.composer*`
  - `.modal*`
  - `.settings*`
- 变更重点：
  - 重建主布局、侧栏、设置弹层、消息区、输入区视觉
  - 增加 tab、setting shell、agent summary 等样式

### 高概率修改文件

3. `e:\other-code\desktop-tools\src\renderer\features\composer\Composer.tsx`
- 修改类型：重构
- 变更重点：
  - 改造为参考 UI 的一体化输入卡片
  - 保留 `onSubmit` / `onCancel` / `onThinkingModeChange` / `onKeyDown`
  - 明确运行态与按钮禁用逻辑

4. `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`
- 修改类型：重构
- 变更重点：
  - 优化 assistant/user/tool 的视觉结构
  - 保留 reasoning bubble、tool expand/collapse、copy 逻辑
  - 保留 `message-model` 作为消息展示数据源

5. `e:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx`
- 修改类型：适配
- 变更重点：
  - 适配统一设置壳后的内容布局
  - 保留配置字段与提交流程

### 新增文件（渲染层组件拆分，非新功能文件）
仅在确有必要时新增，且只新增用于承载现有 UI 的 React 组件，不新增新的业务层。

建议新增候选：
- `e:\other-code\desktop-tools\src\renderer\features\layout\SidebarPanel.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\layout\ConsolePanel.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\layout\SettingsDialogShell.tsx`

说明：这些文件仅用于拆分 `App.tsx` 的渲染结构，不引入新的执行逻辑。

## 数据流路径

### 运行主流程
1. 用户在 `Composer` 输入内容并提交
2. `App.tsx` 的 `handleRunAgent` 更新输入历史、追加 user message、设置运行状态
3. 调用 `window.desktopApp.runAgent(...)`
4. 主进程执行 agent
5. 流式事件通过 `window.desktopApp.onAgentStream(...)` 回到渲染层
6. `appendAssistantStreamDelta(...)` 拼接 assistant 增量消息
7. 最终响应回填完整消息列表

本次重构要求：以上流程完全不变。

### 审批流程
1. 主进程发出 `onToolConfirmationRequested`
2. `App.tsx` 设置 `confirmationRequest`
3. UI 展示确认卡片
4. 用户确认/拒绝
5. `respondToolConfirmation(...)` 将结果回传主进程

本次重构要求：审批事件的显示时机和反馈语义不变。

### 配置保存流程
1. 设置表单变更更新 `formValues`
2. 提交时调用 `saveConfigWithValues`
3. 转换为 `Partial<AppConfig>` 后通过 `window.desktopApp.saveConfig(...)` 保存
4. 保存结果回写 `config` 与 `formValues`

本次重构要求：字段、保存时机、掩码展示与 thinkingMode 的持久化逻辑不变。

## 详细实现思路

### 1. 将主界面拆为三段式壳层
参考：
- `E:\other-code\agent-ui\app\page.tsx:12`
- `E:\other-code\agent-ui\components\console.tsx:27`
- `E:\other-code\agent-ui\components\sidebar.tsx:17`

目标结构示意：

```tsx
<div className="app-shell app-shell-redesign">
  <SidebarPanel
    agents={agents}
    selectedAgentId={selectedAgentId}
    inputHistory={inputHistory}
    onSelectAgent={handleAgentSelection}
    onSelectHistory={handleHistoryClick}
    onOpenSettings={() => setSettingsDialogOpen(true)}
  />

  <ConsolePanel
    selectedAgent={...}
    messages={visibleMessages}
    isRunning={isRunning}
    confirmationRequest={confirmationRequest}
    lastError={lastError}
    ...
  />

  <SettingsDialogShell
    open={settingsDialogOpen}
    activeTab={settingsDialogTab}
    ...
  />
</div>
```

要求：
- 数据仍由 `App.tsx` 提供
- 新容器组件只负责展示与事件转发

### 2. 将多个 modal 收敛到统一设置壳
当前 `App.tsx` 维护：
- `showSettingsModal`
- `showSkillsModal`
- `showAgentsModal`
- `showMcpModal`
- `showAboutModal`

重构后建议改为：

```tsx
type SettingsDialogTab = 'agents' | 'skills' | 'mcp' | 'general' | 'about';

const [settingsDialogState, setSettingsDialogState] = useState<{
  open: boolean;
  tab: SettingsDialogTab;
}>({ open: false, tab: 'agents' });
```

并提供统一入口：

```tsx
function openSettingsDialog(tab: SettingsDialogTab) {
  setSettingsDialogState({ open: true, tab });
}
```

这样可以把“更多”菜单中各入口统一映射到同一个弹层壳。

### 3. 重构会话头部
参考：
- `E:\other-code\agent-ui\components\console.tsx:30`

目标：
- 显示当前智能体名称、描述、模型摘要
- 未选择智能体时显示默认模式提示
- 保留“重置会话”和“更多”操作

实现方式：
- 使用 `selectedAgentId` 从 `agents` 派生当前 agent
- 不引入额外 store
- 不改变 reset/menu 事件逻辑

### 4. 重构消息区但保留模型
参考：
- `E:\other-code\agent-ui\components\message-bubble.tsx:27`

现有 `MessageList` 已具备较好的数据模型，应继续复用：
- `getMessageBodyModel(...)`
- `parseToolMessage(...)`
- `hasAssistantReasoning(...)`
- `getAssistantReasoningText(...)`

可调整为更清晰的视觉层：
- user：右对齐卡片
- assistant：左对齐图标 + 内容栈
- reasoning：可折叠或弱化展示的子卡片
- tool：独立状态卡片，保留展开/收起

### 5. 重构输入区
参考：
- `E:\other-code\agent-ui\components\input-area.tsx:27`

但必须额外保留本项目已有能力：
- 运行中禁用输入
- 取消按钮
- 思考模式保存到配置

目标布局：
- 输入框和操作条合并为单一卡片
- 左侧思考模式开关
- 右侧取消 / 发送按钮
- 保留 `Enter 发送 / Shift+Enter 换行`

### 6. 统一设置壳承载现有管理面板
参考：
- `E:\other-code\agent-ui\components\settings-dialog.tsx:36`

实现原则：
- 不重写 `AgentsPanel` / `SkillsPanel` / `McpServersPanel` 的内部逻辑
- 只改变它们在统一容器中的挂载位置与外层布局
- `SettingsPanel` 作为 `general` 页签内容
- `about` 页签复用 `statusText` 与应用信息

## 边界条件与异常处理

### 边界 1：流式生成中切换 UI 结构
- 不应改变 `activeStreamAgentIdRef` 的工作方式
- 不应因容器组件拆分导致 stream 事件重复订阅
- `onAgentStream` 与 `onToolConfirmationRequested` 仍只在 `App.tsx` 订阅一次

### 边界 2：工具审批与运行态互斥显示
当前已有逻辑：
- 有审批请求时隐藏 running activity
- 有 streaming assistant 可见内容时隐藏 running activity

重构后必须保留：
- `showRunningActivityPanel`
- `showErrorActivityPanel`
- `confirmationRequest` 优先级

### 边界 3：默认模式与已删除智能体
当前逻辑：
- 若选中的智能体被删除，回退到默认模式

重构后必须保留：
- `handleAgentsChanged(...)` 的回退行为

### 边界 4：消息为空时的欢迎文案
当前 `visibleMessages` 会在无消息时显示默认欢迎内容。

重构后必须保留该兜底行为，避免空白页。

### 边界 5：表单与 API key 掩码
- 不得在 UI 或日志中意外展示已保存的明文 API key
- 仅在用户手动切换显示时展示输入框中的当前值
- 已存储值依旧只显示 `maskedApiKey`

## 预期结果

完成后应达到以下结果：

1. `desktop-tools` 的整体视觉与信息架构接近 `agent-ui`，但仍保持 Electron 桌面工具语义。
2. 主界面从“大型单页 JSX”重构为清晰的 Sidebar / Console / Settings Shell 结构。
3. 消息区、输入区、侧栏、设置弹层的体验明显提升。
4. 所有执行逻辑保持不变：
   - 发送消息
   - 流式输出
   - 工具调用
   - 工具审批
   - 配置保存
   - 智能体切换
   - 输入历史回填
5. 不引入新的运行时依赖，不迁移到 Tailwind，不替换现有 IPC 和主进程实现。

## 验收标准

- 发送消息、取消执行、重置会话行为与重构前一致
- reasoning、tool message、final answer 的显示语义不变
- 工具审批可以正常出现并响应
- 智能体、Skills、MCP、设置、关于均可从统一设置壳访问
- 输入历史与智能体切换行为正常
- `npm run build` 与 `npm run typecheck` 能通过

## 实施取舍

本次优先级：
1. 完成 UI 壳层与布局重构
2. 完成统一设置弹层
3. 完成消息区与输入区风格重构
4. 保证行为零回归

本次不包含：
- 主进程逻辑改造
- IPC 协议改造
- agent / skill / MCP 数据结构重构
- 从 CSS 迁移到 Tailwind/shadcn
- 新增业务功能
