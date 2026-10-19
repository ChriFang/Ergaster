# 主界面 Workflow 入口侧边栏化重构设计文档

> 状态：草案 v1 · 2026-06-28
> 范围：将 workflow 的选择/切换入口从「主控制台右上角模式下拉」迁移到「主界面左侧侧边栏新增 workflow tab」，并统一聊天 / 工作流的模式切换路径。
> 决策结论（已与需求方确认）：
> - 自定义工作流的 seedPrompt 来源：**主控制台输入框**（与 debate/deep_research 一致，先选模式再输入提交）
> - 侧边栏 workflow tab 能力：**仅选择与启动**（编辑/删除/新建仍在设置面板 WorkflowsPanel）
> - 设置面板 WorkflowsPanel 编辑器内「运行」按钮：**保留**
> - 移除右上角 ViewModeSwitcher 后头部右侧：**显示当前模式/名称，可点击**（点击切到侧边栏对应 tab / 回到该模式）

---

## 1. 背景与目标

### 1.1 需求
1. 在主界面左侧侧边栏新增 **workflow tab**，位置在「智能体」tab 之后、「输入记录」tab 之前。
2. workflow tab 展示「辩论模式」/「深度调研」以及**自定义工作流**；**不展示聊天模式**。
3. 用户在「智能体」tab 选中某个智能体 → 自动切到对应的**聊天模式**。
4. 用户在 workflow tab 选中某个 workflow → 自动切到对应的**workflow 模式**。
5. 去掉原主界面右上角的 workflow 列表（实为模式下拉 `ViewModeSwitcher`）。
6. 目的：优化 workflow 的展示与使用，让模式切换收敛到侧边栏，职责清晰。

### 1.2 现状关键发现
- 左侧侧边栏 [SidebarPanel.tsx](src/renderer/features/layout/SidebarPanel.tsx) 当前只有两个 tab：`agents`（智能体）/ `history`（输入记录），类型见 [SidebarPanel.tsx:16](src/renderer/features/layout/SidebarPanel.tsx#L16)。智能体 tab 内含一个「默认模式」条目（`onSelectAgent(null)`，[SidebarPanel.tsx:99](src/renderer/features/layout/SidebarPanel.tsx#L99)）。
- 主控制台模式状态在 [use-workflow-session.ts:12-14](src/renderer/lib/hooks/use-workflow-session.ts#L12)：
  - `mode: 'chat' | 'workflow'`
  - `selectedWorkflowType: 'debate' | 'deep_research'`（**不含 custom**）
- 右上角「workflow 列表」实为模式下拉 [ViewModeSwitcher.tsx](src/renderer/features/layout/ViewModeSwitcher.tsx)，选项 `聊天模式 / 辩论模式 / 深度调研`（[ViewModeSwitcher.tsx:12](src/renderer/features/layout/ViewModeSwitcher.tsx#L12)），分别渲染在 [ChatConsoleView.tsx:86](src/renderer/features/layout/ChatConsoleView.tsx#L86) 与 [WorkflowConsoleView.tsx:169](src/renderer/features/workflows/WorkflowConsoleView.tsx#L169) 头部。
- 模式切换链路：`ViewModeSwitcher.onChange` → [ConsolePanel.tsx:94](src/renderer/features/layout/ConsolePanel.tsx#L94) `handleViewModeChange` → `onSwitchMode` / `onSelectedWorkflowTypeChange`。
- 提交路由：[App.tsx:160](src/renderer/App.tsx#L160) `handleSubmit`：`mode==='workflow'` → `startWorkflow()`（用输入框 `input` 作 topic，[use-workflow-session.ts:39](src/renderer/lib/hooks/use-workflow-session.ts#L39)）；否则 `handleRunAgent()`。
- 智能体选中 `handleAgentSelection`（[use-chat-session.ts:35](src/renderer/lib/hooks/use-chat-session.ts#L35)）当前**只设置 selectedAgentId + 加载会话**，**未切换 mode** —— 需补 `setMode('chat')`。
- 自定义工作流当前仅从设置面板 [WorkflowsPanel](src/renderer/features/workflows/WorkflowsPanel.tsx) 启动：收集 seedPrompt 弹窗 → `onRunWorkflow` → [App.tsx:274](src/renderer/App.tsx#L274) → `startCustomWorkflow(workflowId, seedPrompt)`（[use-workflow-session.ts:74](src/renderer/lib/hooks/use-workflow-session.ts#L74)）。
- 自定义工作流定义列表已有 IPC：`desktopAppClient.listWorkflows()`（[desktop-app-client.ts](src/renderer/lib/desktop/desktop-app-client.ts)），返回 `WorkflowDefinitionListItem[]`。

### 1.3 目标
- 侧边栏成为聊天 / 工作流模式的**唯一切换入口**。
- workflow tab 统一承载：内置（辩论/深度调研）+ 自定义工作流的**选择与启动**。
- 移除主控制台头部 `ViewModeSwitcher`，头部右侧改为当前模式/名称展示。
- 自定义工作流启动改为「侧边栏选中 → 输入框输入 seedPrompt → 提交运行」，与内置工作流体感一致。

### 1.4 非目标
- 不改 workflow 运行时（`workflow-service` / debate / deep_research / custom 执行器）。
- 不改设置面板 WorkflowsPanel 的编辑/新建/删除能力（仅保留其「运行」按钮）。
- 不改智能体创建/运行机制。
- 不引入工作流运行历史在侧边栏的展示（运行历史仍由 `WorkflowConsoleView` / `listWorkflowRuns` 承担）。

---

## 2. 整体方案概览

```
主界面 App
 ├── SidebarPanel（左侧侧边栏）
 │    ├── tab: 智能体（agents）   ← 选中 → setMode('chat') + setSelectedAgentId
 │    ├── tab: workflow（新增）   ← 选中 → setMode('workflow') + setSelectedWorkflow(...)
 │    │    ├── 内置：辩论模式 / 深度调研
 │    │    └── 自定义：listWorkflows() 列表（仅选择/启动）
 │    └── tab: 输入记录（history）
 │
 └── ConsolePanel（主控制台）
      ├── 头部右侧：当前模式/名称展示（替换原 ViewModeSwitcher）
      ├── mode==='workflow' → WorkflowConsoleView
      └── mode==='chat'     → ChatConsoleView
           └── 底部输入框：chat 模式作 prompt；workflow 模式作 topic / seedPrompt
```

提交路由（`handleSubmit`）按当前选中模式分流：
- chat → `handleRunAgent()`
- workflow + 内置 → `startWorkflow(selectedWorkflowType)`
- workflow + 自定义 → `startCustomWorkflow(selectedCustomWorkflowId, input)`

---

## 3. 状态模型变更（use-workflow-session.ts）

### 3.1 选中工作流的统一表示
当前 `selectedWorkflowType: 'debate' | 'deep_research'` 不含 custom。新增 custom 维度，采用**类型 + 可选自定义 id** 的组合，最小侵入：

```ts
// 选中模式类型扩展（含 custom）
type SelectedWorkflowType = 'debate' | 'deep_research' | 'custom';

const [selectedWorkflowType, setSelectedWorkflowType] = useState<SelectedWorkflowType>('debate');
// 仅当 selectedWorkflowType === 'custom' 时有意义
const [selectedCustomWorkflowId, setSelectedCustomWorkflowId] = useState<string | null>(null);
```

> 不引入新的联合对象类型，避免大范围改签名；`selectedCustomWorkflowId` 与 `selectedWorkflowType` 配对使用。

### 3.2 新增/修改的方法
- `selectBuiltInWorkflow(type: 'debate' | 'deep_research')`：`setSelectedWorkflowType(type)` + `setSelectedCustomWorkflowId(null)` + `setMode('workflow')` + 若与当前 `activeRun.type` 不同则清空旧 run（复用现 `changeWorkflowType` 的清空逻辑，见 [use-workflow-session.ts:155](src/renderer/lib/hooks/use-workflow-session.ts#L155)）。
- `selectCustomWorkflow(workflowId: string)`：`setSelectedWorkflowType('custom')` + `setSelectedCustomWorkflowId(workflowId)` + `setMode('workflow')` + 清空非 custom 的旧 run。
- `selectChatMode()`：`setMode('chat')`。（供智能体选中时调用；不强制清空 activeRun，允许用户切回 workflow tab 继续查看。）

### 3.3 提交路由扩展
`startWorkflow` 现仅处理 debate/deep_research。新增统一提交入口或在 `handleSubmit` 中分流：

```ts
// handleSubmit (App.tsx)
if (mode === 'workflow') {
  if (selectedWorkflowType === 'custom' && selectedCustomWorkflowId) {
    void startCustomWorkflow(selectedCustomWorkflowId, input); // input 作 seedPrompt
  } else {
    void startWorkflow(selectedWorkflowType); // debate / deep_research
  }
  return;
}
void handleRunAgent();
```

`startCustomWorkflow` 现签名 `(workflowId, seedPrompt)` 已满足；只需把 `input` 作为 seedPrompt 传入，并像 `startWorkflow` 一样在成功后 `setInput('')`（当前 `startCustomWorkflow` 未清空输入框，需补，保持与内置一致）。

### 3.4 WorkflowConsoleView 类型推断调整
[WorkflowConsoleView.tsx:153](src/renderer/features/workflows/WorkflowConsoleView.tsx#L153) 当前按 `activeRun?.type` / `selectedWorkflowType` 推断 `workflowType`。需扩展：
- 无 activeRun 时，按 `selectedWorkflowType`（含 `'custom'`）+ `selectedCustomWorkflowId` 决定空态展示（如自定义工作流标题、节点预览）。
- 有 activeRun 时仍以 `activeRun.type` 为准（运行中/回看历史 run 时类型以 run 为准）。

---

## 4. 侧边栏改造（SidebarPanel.tsx）

### 4.1 tab 注册
[SidebarPanel.tsx:16](src/renderer/features/layout/SidebarPanel.tsx#L16) 类型扩展：
```ts
type SidebarTab = 'agents' | 'workflows' | 'history';
```
tab 按钮区 [SidebarPanel.tsx:75](src/renderer/features/layout/SidebarPanel.tsx#L75) 在「智能体」与「输入记录」之间插入：
```tsx
<button ... onClick={() => setActiveTab('workflows')}>
  <Workflow size={15} strokeWidth={2} aria-hidden="true" />  {/* lucide-react Workflow 图标 */}
  <span>workflow</span>
</button>
```
import 增加 `Workflow`。

### 4.2 新增 props
```ts
type SidebarPanelProps = {
  // 既有...
  workflows: WorkflowDefinitionListItem[];            // 自定义工作流列表
  selectedWorkflowType: SelectedWorkflowType;          // 当前选中工作流类型
  selectedCustomWorkflowId: string | null;
  mode: 'chat' | 'workflow';
  onSelectBuiltInWorkflow: (type: 'debate' | 'deep_research') => void;
  onSelectCustomWorkflow: (workflowId: string) => void;
};
```
> 选中态高亮逻辑：workflow tab 内某条目 active 当且仅当 `mode==='workflow'` 且其类型/id 与 `selectedWorkflowType`/`selectedCustomWorkflowId` 匹配。

### 4.3 workflow tab 内容布局
```
┌──────────────────────────────────┐
│ workflow                         │  ← tab
├──────────────────────────────────┤
│ 内置模式                          │  ← section title
│  ┌────────────────────────────┐  │
│  │ 🗣  辩论模式                │  │  ← 选中高亮
│  │    多智能体对抗辩论         │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ 🔍  深度调研                │  │
│  │    多阶段深度研究           │  │
│  └────────────────────────────┘  │
│                                  │
│ 自定义工作流                      │  ← section title
│  ┌────────────────────────────┐  │
│  │ ⚙  <工作流标题>            │  │
│  │    节点: A → B → C          │  │
│  └────────────────────────────┘  │
│  ...                             │
│  （空态：暂无自定义工作流，       │
│   请在设置中创建）                │
└──────────────────────────────────┘
```
- 复用既有类名风格：`app-sidebar-section` / `app-sidebar-section-title` / `app-agent-item` 系列（与智能体列表同构）。
- 内置条目用固定图标（`lucide-react` 的 `MessagesSquare` / `Search` 等）+ 文案。
- 自定义条目用 `Workflow` 图标占位，meta 行显示 `节点: A → B → C`（取 `WorkflowDefinitionListItem.agentTitles`，超长截断）。
- 自定义列表为空时显示 `app-sidebar-empty`：「暂无自定义工作流，请在设置中创建」。
- **不展示聊天模式**（聊天模式由智能体 tab 进入）。

### 4.4 智能体 tab 行为补全
当前 `onSelectAgent` → `handleAgentSelection`（[use-chat-session.ts:35](src/renderer/lib/hooks/use-chat-session.ts#L35)）未切 mode。在 App.tsx 的 `onSelectAgent` 回调中追加 `selectChatMode()`（或直接 `setMode('chat')`）：
```ts
onSelectAgent={(agentId) => {
  void handleAgentSelection(agentId);
  selectChatMode();   // 新增：切到聊天模式
}}
```
> 「默认模式」条目（`onSelectAgent(null)`）同样走此路径 → chat 模式，符合预期。

---

## 5. 控制台头部改造（移除 ViewModeSwitcher）

### 5.1 移除点
- [ChatConsoleView.tsx:86](src/renderer/features/layout/ChatConsoleView.tsx#L86)：移除 `<ViewModeSwitcher ... />`。
- [WorkflowConsoleView.tsx:169](src/renderer/features/workflows/WorkflowConsoleView.tsx#L169)：移除 `<ViewModeSwitcher ... />`。
- [ConsolePanel.tsx:94](src/renderer/features/layout/ConsolePanel.tsx#L94) `handleViewModeChange` 及相关 `viewMode` 派生、`onViewModeChange` / `onSelectedWorkflowTypeChange` 透传 props 可一并清理（若无其他消费者）。
- `ViewModeSwitcher.tsx` 文件本身：若无其他引用则删除；保留亦无害，建议删除以减负。

### 5.2 头部右侧替代展示
头部右侧改为**当前模式/名称**展示，**可点击**（非下拉，但支持点击交互）：
- chat 模式：显示当前智能体名（`selectedAgentId` 对应 title，或「默认模式」）。
- workflow 模式：
  - custom → 显示选中自定义工作流标题（从 `workflows` 列表按 id 查）。
  - debate → 「辩论模式」。
  - deep_research → 「深度调研」。
  - 运行中/有 activeRun 时优先显示 `activeRun.title`。
- **点击行为**：点击 badge 切换到侧边栏对应 tab 并保持当前模式选中态（即把侧边栏 `activeTab` 切到 `agents` / `workflows`）。badge 不切换模式本身（模式切换由侧边栏条目完成），仅作为「定位回侧边栏对应 tab」的快捷入口。如需更强语义，可扩展为点击 chat badge 回到默认模式、点击 workflow badge 回到当前选中工作流——**本次采用前者（切 tab，不改模式）**，避免误触改模式。
- 复用现有 `view-mode-switcher` 外观样式或新增轻量 `console-mode-badge` 类（可点击 span，带 hover 反馈，无下拉）。

> 该展示为只读标识 + 点击定位；模式切换仍由侧边栏条目完成。

---

## 6. App.tsx 接线变更

1. 加载自定义工作流列表：仿 agents 列表加载，在 App 挂载/设置关闭后调用 `desktopAppClient.listWorkflows()` 存入 state（如 `workflows`），传给 `SidebarPanel`。建议在打开设置/工作流变更后刷新（设置面板关闭时 reload，与 agents 一致）。
2. `SidebarPanel` 新增 props 透传：`workflows` / `selectedWorkflowType` / `selectedCustomWorkflowId` / `mode` / `onSelectBuiltInWorkflow` / `onSelectCustomWorkflow`。
3. `onSelectAgent` 追加 `selectChatMode()`。
4. `handleSubmit` 按 3.3 分流 custom。
5. `ConsolePanel` 移除 `onViewModeChange` / `onSelectedWorkflowTypeChange` 等下拉相关 props；新增头部展示所需的 `currentModeLabel`（或在 ConsolePanel 内据 mode + 选中态计算）。
6. 设置面板 `onRunWorkflow`（[App.tsx:274](src/renderer/App.tsx#L274)）保留：运行后仍 `closeSettingsDialog()` + `startCustomWorkflow`，并同步把 `selectedWorkflowType` 置 `'custom'` + `selectedCustomWorkflowId` 置该 id，使侧边栏高亮与头部展示一致。

---

## 7. 数据流：选中 → 展示 → 提交

### 7.1 选自定义工作流并运行
```
侧边栏点自定义条目
  → onSelectCustomWorkflow(id)
  → selectCustomWorkflow(id): setMode('workflow') + setSelectedWorkflowType('custom')
                              + setSelectedCustomWorkflowId(id) + 清旧 run
  → ConsolePanel 渲染 WorkflowConsoleView（空态，显示该工作流标题/节点预览）
  → 用户在输入框输入 seedPrompt → 提交
  → handleSubmit: mode==='workflow' && selectedWorkflowType==='custom'
  → startCustomWorkflow(id, input)  // input 作 seedPrompt，成功后 setInput('')
  → 流式更新 activeRun → WorkflowConsoleView 展示
```

### 7.2 选智能体回到聊天
```
侧边栏点智能体条目
  → onSelectAgent(id) → handleAgentSelection(id) + selectChatMode()
  → ConsolePanel 渲染 ChatConsoleView
  → 头部右侧显示该智能体名
```

### 7.3 内置工作流
```
侧边栏点「辩论模式」/「深度调研」
  → onSelectBuiltInWorkflow(type)
  → selectBuiltInWorkflow(type): setMode('workflow') + setSelectedWorkflowType(type)
                                 + setSelectedCustomWorkflowId(null) + 清旧 run
  → 输入框输入 topic → 提交 → startWorkflow(type)  // 既有路径不变
```

---

## 8. 边界与一致性

1. **运行中切换**（已确认：**需弹窗提示**）：`isWorkflowRunning` 时，用户在侧边栏切换工作流/智能体（即离开当前运行中的模式）需先弹确认。沿用项目原生 `confirm(message)` 模式（与 [AgentsPanel.tsx:165](src/renderer/features/agents/AgentsPanel.tsx#L165) 删除确认一致），无需新增组件：
   - 触发点：`onSelectAgent` / `onSelectBuiltInWorkflow` / `onSelectCustomWorkflow` 在执行切换前判断 `isWorkflowRunning`。
   - 文案示例：`当前有工作流正在运行，切换后将中断该运行。是否继续？`
   - 用户「确认」→ 调 `cancelWorkflow()` 终止当前 run，再执行目标切换；「取消」→ 不切换，保持现状。
   - **同条目重复点击**（切到当前已选中项）不触发确认、不取消 run。
   - 头部 `console-mode-badge` 点击仅切 tab、不改模式，运行中点击不触发此确认（不涉及中断）。
2. **清旧 run 时机**：仅当新选中类型/id 与当前 `activeRun.type`（或 custom 的 run workflowId）不一致时清空，避免重复点击同一条目抹掉进行中的结果。
3. **自定义工作流失效**：侧边栏列表来自 `listWorkflows()`，定义体引用的智能体可能已删——侧边栏仅展示标题/节点预览，不阻断选择；失效在**运行时**由 `executeCustomInBackground` 报错终止（已由既有 custom 设计覆盖）。
4. **列表刷新**：在设置面板新建/编辑/删除自定义工作流后关闭对话框时，重新 `listWorkflows()` 刷新侧边栏。
5. **selectedCustomWorkflowId 持久化**：本次不做跨会话持久化（与 `selectedWorkflowType` 现状一致，均为内存态）。

---

## 9. 样式
- 新增类名遵循项目约定：`app-workflow-list`、`app-workflow-item`、`app-workflow-item-active`、`app-workflow-item-meta`、`console-mode-badge`（头部只读标识）。
- 复用 `app-sidebar-section` / `app-sidebar-section-title` / `app-sidebar-empty` / `agent-avatar-*`。
- 内置模式条目图标用 `lucide-react`，配色沿用青蓝主色与现有 active 态。
- 头部 `console-mode-badge`：只读 span，无 hover/下拉，样式贴近原 `view-mode-trigger-label` 但去除交互感。

---

## 10. 实施步骤清单

1. **状态层**：[use-workflow-session.ts](src/renderer/lib/hooks/use-workflow-session.ts) 扩展 `selectedWorkflowType` 含 `'custom'` + 新增 `selectedCustomWorkflowId`；新增 `selectBuiltInWorkflow` / `selectCustomWorkflow` / `selectChatMode`；`startCustomWorkflow` 成功后 `setInput('')`。运行中切换的 `cancelWorkflow` 时机由调用方（App.tsx 切换回调）按确认结果触发。
2. **侧边栏**：[SidebarPanel.tsx](src/renderer/features/layout/SidebarPanel.tsx) 新增 `workflows` tab（类型、按钮、内容区、props）；接入选中态高亮。
3. **App 接线**：加载 `workflows` 列表；透传新 props；`onSelectAgent` / `onSelectBuiltInWorkflow` / `onSelectCustomWorkflow` 在 `isWorkflowRunning` 时先 `confirm` → 确认则 `cancelWorkflow()` 再切换；`handleSubmit` 分流 custom；设置 `onRunWorkflow` 同步选中态；设置关闭刷新列表。
4. **头部移除**：删除 [ChatConsoleView.tsx](src/renderer/features/layout/ChatConsoleView.tsx) / [WorkflowConsoleView.tsx](src/renderer/features/workflows/WorkflowConsoleView.tsx) 中的 `ViewModeSwitcher`；清理 [ConsolePanel.tsx](src/renderer/features/layout/ConsolePanel.tsx) 下拉相关 props/逻辑；删除/废弃 `ViewModeSwitcher.tsx`。
5. **头部展示**：新增可点击 `console-mode-badge`，按 mode + 选中态 + activeRun.title 显示；点击切到侧边栏对应 tab（不改模式）。
6. **WorkflowConsoleView 推断**：扩展 `workflowType` 推断支持 `selectedWorkflowType==='custom'` + 空态展示。
7. **样式**：追加 `app-workflow-*` / `console-mode-badge`（含 hover/可点击态）样式到 [styles.css](src/renderer/styles.css)。
8. **自测**：
   - 智能体 tab 选中 → 切 chat 模式 + 头部 badge 显示智能体名 + 点击 badge 回到智能体 tab。
   - workflow tab 选辩论/深度调研 → 切 workflow 模式 + 输入提交运行。
   - workflow tab 选自定义 → 切 workflow 模式 + 输入 seedPrompt 提交运行。
   - 设置面板运行自定义工作流 → 侧边栏/头部 badge 同步高亮。
   - **运行中切条目** → 弹确认；确认则中断旧 run 并切换，取消则保持；同条目重复点击不弹确认。
   - 右上角下拉已彻底移除，无残留入口。

---

## 11. 待确认 / 后续

- ✅ 运行中切模式：**已确认需弹窗提示**（原生 `confirm`，确认则 `cancelWorkflow` 再切换，见 8.1）。
- ✅ 头部标识可点击：**已确认可点击**（点击切到侧边栏对应 tab，不改模式，见 5.2）。
- 自定义工作流在侧边栏是否需要分组/搜索（数量多时）？本次不做，后续按需。
