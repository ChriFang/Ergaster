# 自定义工作流编辑器（WorkFlow 设置项）设计文档

> 状态：草案 v1 · 2026-06-28
> 范围：在设置面板新增「WorkFlow」设置项，支持工作流的列表管理 + 画布编辑 + 立即运行。
> 决策结论（已与需求方确认）：
> - 功能范围：**编辑 + 立即运行**
> - 与现有 workflow 子系统关系：**复用并改造现有 `workflow-service`**
> - 画布方案：**引入 React Flow（`@xyflow/react`）**
> - 拓扑：**线性链路**（上一节点输出 → 下一节点输入，节点 = 智能体 + 可选输入模板）

---

## 1. 背景与目标

### 1.1 需求
在 APP 设置面板中增加一个 WorkFlow 设置项：
1. 点击后先展示**已配置工作流列表**，支持增加 / 删除 / 编辑。
2. 编辑界面类似画流程图：在一块**画布**上增删改流程节点；每个节点是一个**智能体**，编辑时可指定该节点对应的智能体。
3. 智能体创建逻辑已存在，不复做。
4. 支持对编辑好的工作流**立即运行**。
5. UI 风格与现有项目一致（暗色、青蓝主色、自研组件 + `lucide-react`）。

### 1.2 现状关键发现
- 技术栈：Electron + React 19 + Vite + TypeScript；无 UI 库，自研组件 + `lucide-react`；全局 `src/renderer/styles.css` + CSS 变量；无 i18n（中文内联）。
- 设置面板：模态对话框 `SettingsDialogShell`，左侧导航 + 右侧内容区。Tab 注册于 [SettingsDialogShell.tsx:20](src/renderer/features/layout/SettingsDialogShell.tsx#L20)，类型 [app-shell.ts:8](src/renderer/lib/types/app-shell.ts#L8)，渲染 switch 在 [App.tsx:264](src/renderer/App.tsx#L264)。现有 tab：`agents / skills / mcp / general / about`。
- 智能体（Agent）已完整实现：类型见 [agent-profile.ts](src/shared/agent-profile.ts)，持久化 `~/.ergaster/agents/<id>/{AGENT.md,agent.json}`，IPC `agent-profile:*`，运行入口 `agentService.run({prompt, agentId?})`（[agent-service.ts:253](src/main/agent-service.ts#L253)）。
- **已存在 workflow 子系统**（重要）：
  - 共享类型 [workflow.ts](src/shared/workflow.ts)：`WorkflowType`、`WorkflowRun`、`WorkflowActor`、`WorkflowStage`、`WorkflowArtifact`、`WorkflowStreamEvent`。
  - 主服务 [workflow-service.ts](src/main/workflow-service.ts)：通用运行生命周期（run 注册表、abort、流式监听、`emitStreamEvent`、`cancelWorkflow`、`getWorkflowRun`、`listWorkflowRuns`）+ `debate` / `deep_research` 两个特化分支。
  - 运行器 `src/main/workflows/debate-runner.ts` / `deep-research-runner.ts`。
  - 前端 [use-workflow-session.ts](src/renderer/lib/hooks/use-workflow-session.ts) + `WorkflowConsoleView`：主控制台 workflow 模式，消费 `WorkflowStreamEvent`。
  - 该系统目前**不在设置面板**，且工作流类型**硬编码**，用户不可自定义。
- 项目**未安装**任何流程图库（无 reactflow / x6 / jsplumb / drawflow）。

### 1.3 目标
- 新增「WorkFlow」设置 tab，提供列表管理 + 画布编辑。
- 工作流定义为**线性智能体链路**，可持久化、可编辑。
- 运行时复用现有 `WorkflowService` 的生命周期与流式通道，新增一个 `custom`（线性链）执行分支。
- 运行结果在主控制台现有 `WorkflowConsoleView` 中展示（最大化复用）。

### 1.4 非目标
- 不做 DAG / 分支 / 循环 / 条件节点（本次仅线性）。
- 不重构 `debate` / `deep_research` 现有逻辑，仅在其旁新增 `custom` 分支。
- 不改智能体创建/运行机制。
- 不做多用户/协作、版本管理。

---

## 2. 整体方案概览

```
设置对话框 SettingsDialogShell
  └── 新增 tab: workflow
       └── WorkflowsPanel（列表页，镜像 AgentsPanel）
            ├── 顶部：创建工作流 / 打开目录
            ├── 工作流卡片列表（编辑 / 删除 / 运行）
            └── 编辑态 → WorkflowEditor
                 ├── 元信息：标题 / 描述
                 ├── React Flow 画布（线性节点链）
                 │    └── 节点卡片 = 智能体选择 + 输入模板 + 删除/上下移
                 ├── 节点工具条：添加节点
                 └── 操作：保存 / 取消 / 运行

持久化：~/.ergaster/workflows/<id>/workflow.json
         （WorkflowDefinitionsService，镜像 AgentProfilesService）

运行：WorkflowService 新增 startCustomWorkflow(definition, seedPrompt)
       → executeCustomInBackground：按节点顺序调用 agentService
       → 复用 emitStreamEvent / WorkflowStreamEvent
       → 主控制台 WorkflowConsoleView 展示运行结果
```

---

## 3. 数据模型设计（shared 层）

新增文件 `src/shared/workflow-definition.ts`：

```ts
// 一个工作流节点 = 一个智能体 + 可选输入模板
export type WorkflowNode = {
  id: string;                 // 节点实例 id（画布内唯一）
  agentId: string;            // 引用的智能体 id
  label?: string;             // 节点显示名（缺省取智能体 title）
  inputTemplate?: string;     // 输入模板，支持 {{input}} 占位符
  // 画布坐标（React Flow）
  position: { x: number; y: number };
};

// 工作流定义（持久化对象）
export type WorkflowDefinition = {
  id: string;
  title: string;
  description: string;
  nodes: WorkflowNode[];      // 线性链：数组顺序即执行顺序
  createdAt: string;
  updatedAt: string;
  directoryName: string;
  directoryPath: string;
};

// 列表项（不含 nodes 详情，轻量）
export type WorkflowDefinitionListItem = {
  id: string;
  title: string;
  description: string;
  nodeCount: number;
  agentTitles: string[];      // 用于列表预览
  createdAt: string;
  updatedAt: string;
};

export type CreateWorkflowDefinitionRequest = {
  title: string;
  description: string;
  nodes: WorkflowNode[];
};

export type UpdateWorkflowDefinitionRequest = {
  id: string;
  title: string;
  description: string;
  nodes: WorkflowNode[];
};

export type WorkflowDefinitionOperationResult = {
  ok: boolean;
  error?: string;
  data?: WorkflowDefinition;
};

// 运行入参
export type CustomWorkflowRunInput = {
  workflowId: string;
  seedPrompt: string;         // 链路起点输入
};
```

### 3.1 现有 `WorkflowType` 扩展
在 [workflow.ts:3](src/shared/workflow.ts#L3) 的 `WorkflowType` 联合类型中新增 `'custom'`：

```ts
export type WorkflowType = 'chat' | 'debate' | 'deep_research' | 'simulation' | 'forecast' | 'custom';
```

### 3.2 输入模板语义
- `{{input}}`：上游节点输出（首节点为 `seedPrompt`）。
- 模板为空时：首节点直接以 `seedPrompt` 为输入；后续节点直接以上一节点输出为输入。
- 模板可含固定文案，例如 `"请对以下内容进行摘要：\n{{input}}"`。

---

## 4. 持久化与服务层（main 层）

新增 `src/main/workflow-definitions-service.ts`，**镜像** [agent-profiles-service.ts](src/main/agent-profiles-service.ts) 的结构：

- 目录：`~/.ergaster/workflows/`（与 `agents/` 同级）。
- 每个工作流一个目录 `<id>/`，内含 `workflow.json`（完整定义）。
- 方法：
  - `scanAndLoadWorkflows()`：扫描目录加载全部。
  - `getWorkflowDefinition(id)`：取详情。
  - `createWorkflow(req)`：生成 id + 目录 + 写文件。
  - `updateWorkflow(req)`：覆盖写。
  - `deleteWorkflow(id)`：删目录。
  - `reloadWorkflows()`：重新扫描。
- 启动时预加载（参考 [index.ts:180](src/main/index.ts#L180) 对 agents 的预加载）。
- id 生成、时间戳、目录名校验复用 agent 服务同一套工具函数。

> 不放入 `config.json`：工作流定义体量较大且是“资源”性质，与 agents/skills 一致采用独立目录文件，便于“打开目录”手动编辑。

---

## 5. IPC 与 preload

### 5.1 新增 IPC handlers（`src/main/workflow-definition-handlers.ts`，镜像 `agent-profile-handlers.ts`）
- `workflow-definition:list`
- `workflow-definition:get`
- `workflow-definition:create`
- `workflow-definition:update`
- `workflow-definition:delete`
- `workflow-definition:reload`
- `workflow-definition:open-directory`

在 [index.ts](src/main/index.ts) 中注册（紧邻 agent-profile handlers）。

### 5.2 运行 IPC
在 `WorkflowService` 新增方法并注册 IPC：
- `startCustomWorkflow(input: CustomWorkflowRunInput): Promise<{ run: WorkflowRun }>`
- 复用已有 `cancelWorkflow` / `getWorkflowRun` / `listWorkflowRuns` / stream 通道。

### 5.3 preload 暴露（[preload/index.ts](src/preload/index.ts)）
在 `window.desktopApp` 上新增：
```ts
listWorkflows, getWorkflow(id), createWorkflow(req), updateWorkflow(req),
deleteWorkflow(id), reloadWorkflows(), openWorkflowsDirectory(),
startCustomWorkflow(input)
```
`desktop-app-client.ts` 同步封装。

---

## 6. 设置面板接入

改动点（来自调研结论）：

1. [app-shell.ts:8](src/renderer/lib/types/app-shell.ts#L8)：`SettingsDialogTab` 增加 `'workflow'`。
2. [SettingsDialogShell.tsx:20](src/renderer/features/layout/SettingsDialogShell.tsx#L20)：`TAB_ITEMS` 增加 `{ id: 'workflow', label: 'WorkFlow', icon: Workflow }`（`lucide-react` 的 `Workflow` 图标）。
3. [App.tsx:264](src/renderer/App.tsx#L264)：`switch` 增加 `case 'workflow': return <WorkflowsPanel ... />`。
4. 不需要改 `config.json` / `AppConfig`（工作流走独立持久化，非通用设置字段）。

---

## 7. 工作流列表页 UI（`WorkflowsPanel`）

**镜像** [AgentsPanel.tsx](src/renderer/features/agents/AgentsPanel.tsx) 的结构与样式类名。

文件：`src/renderer/features/workflows/WorkflowsPanel.tsx`

- 容器：`<div className="workflows-panel settings-surface-card">`。
- 头部：`settings-page-header` + 标题“WorkFlow 管理”+ 描述 + 「打开目录」「创建工作流」按钮（`ghost-button` / `create-button`）。
- 消息条：复用 `skills-message skills-message-{type}`。
- 列表项 `skill-item` 风格卡片：
  - 左：`Workflow` 图标占位（或首节点智能体头像）。
  - 中：标题 + 描述 + meta 行（`节点数: N` · `智能体: A → B → C`）。
  - 右：`edit-button` / `delete-button` / `运行`（`primary-button` 小尺寸）。
- 空态：`skills-empty`，提示“点击右上角创建工作流”。
- 编辑态：渲染 `<WorkflowEditor>`，隐藏列表与创建按钮（同 AgentsPanel 的 `editingAgent` 模式）。
- 删除二次确认：复用 `confirm(...)` 模式（与 AgentsPanel 一致）。

状态管理：组件内 `useState`（`workflows`、`editing`、`isCreating`、`loading`、`message`），与 AgentsPanel 同构。

---

## 8. 工作流画布编辑器 UI（`WorkflowEditor`，React Flow）

文件：`src/renderer/features/workflows/WorkflowEditor.tsx` + 子组件 `WorkflowNodeCard.tsx`。

### 8.1 布局
```
┌──────────────────────────────────────────────┐
│ 标题输入  描述输入                            │
│ [添加节点]                  [取消][保存][运行]│
├──────────────────────────────────────────────┤
│  React Flow 画布（暗色背景，可拖拽/缩放）      │
│                                              │
│   ┌──────────┐                              │
│   │ 节点1     │  ← 智能体下拉 + 输入模板     │
│   │ Agent: A │                              │
│   └────┬─────┘                              │
│        │                                    │
│   ┌────▼─────┐                              │
│   │ 节点2     │                              │
│   │ Agent: B │                              │
│   └────┬─────┘                              │
│        │                                    │
│   ┌────▼─────┐                              │
│   │ 节点3     │                              │
│   └──────────┘                              │
└──────────────────────────────────────────────┘
```

### 8.2 React Flow 集成
- 依赖：`@xyflow/react`（v12，即 React Flow 新包名）。
- `nodes` / `edges` 由 `WorkflowDefinition.nodes` 派生：
  - `nodes`：每个 `WorkflowNode` → ReactFlowNode，`type: 'workflowAgent'`，`position` 取自字段，`data` 含 `agentId / label / inputTemplate / index / canMoveUp / canMoveDown`。
  - `edges`：线性自动连：`nodes[i].id → nodes[i+1].id`，`type: 'smoothstep'`。
- 自定义节点 `WorkflowNodeCard`（`nodeTypes` 注册）：
  - 顶部：节点序号 + 智能体下拉（选项来自 `listAgents()`，显示头像 + title + model）。
  - 中部：节点标签输入（可选）。
  - 底部：输入模板 `textarea`（占位提示 `{{input}}` 用法）。
  - 右上角操作：`删除`、`上移`、`下移`。
- 「添加节点」：在链尾追加，`position.y` 递增；自动连边。
- 拖拽：允许拖动节点改变位置（更新 `position`）；**线性顺序以数组顺序为准**，不靠坐标推断，避免歧义。上下移按钮显式调整数组顺序并重排 y 坐标。
- `onNodesChange` / `onEdgesChange` 处理位置与选择；删除节点同步从定义中移除。
- 受控保存：编辑器维护本地草稿 state，保存时归一化为 `WorkflowDefinition.nodes` 写回。

### 8.3 校验
- 标题非空。
- 至少 1 个节点。
- 每个节点必须选择 `agentId`。
- 校验失败用 `skills-message-error` 提示，不阻断编辑。

### 8.4 运行入口
- 编辑器右上角「运行」按钮（与「保存」并列）。
- 点击后弹出**种子输入**（seedPrompt）：复用项目内小型输入弹层模式；或用一个简单 `prompt(...)` / 自研小 Modal 收集“本次运行输入”。
- 运行流程见第 9 节。

---

## 9. 运行时（复用并改造 `workflow-service`）

### 9.1 改造点
在 [workflow-service.ts](src/main/workflow-service.ts) 新增 `custom` 分支，**不动** debate/deep_research：

1. 新增 `private createCustomRun(definition, seedPrompt): WorkflowRun`：
   - `type: 'custom'`，`title` 取定义标题。
   - `actors`：`definition.nodes` 映射为 `WorkflowActor`（`id`/`role`/`title` 取自节点与对应智能体）。
   - `stages`：每个节点一个 `WorkflowStage`，`actorIds: [node.agentId]`，`status: 'pending'`。
   - `inputs: { workflowId, seedPrompt }`。
   - `messages`：初始 user 消息（seedPrompt，带 `workflow` meta）。
2. 新增 `startCustomWorkflow(input)`：创建 run、注册、emit `run_updated`、后台执行。
3. 新增 `private async executeCustomInBackground(definition, run, abortController)`：线性执行器。

### 9.2 线性执行器逻辑（`executeCustomInBackground`）
```
prevOutput = run.inputs.seedPrompt
for (node in definition.nodes) {
  if (aborted) break
  mark stage running, emit run_updated
  prompt = node.inputTemplate
            ? node.inputTemplate.replace('{{input}}', prevOutput)
            : prevOutput
  // 失效节点保护：agentId 在 agent-profiles 中已不存在
  if (!agentProfilesService.getAgentDetail(node.agentId)) {
    run.status = 'failed'; run.error = `节点「${node.label ?? node.id}」引用的智能体已失效`; break
  }
  // 调用 agentService，带 workflowMeta 关联到本 run
  result = await agentService.run({
    prompt,
    agentId: node.agentId,
    workflowMeta: { runId, workflowType:'custom', stageId:node.id, actorId:node.agentId }
  })
  // agentService 的流式 chunk 已由 handleAgentStream 桥接为 message_delta
  append assistant message to run.messages
  prevOutput = result.reply
  mark stage completed, emit run_updated
}
emit completed
```

> 复用关键：`agentService` 已支持 `workflowMeta` 透传与流式 chunk 回调（见 [agent-service.ts](src/main/agent-service.ts) 中 `workflow: input.workflowMeta` 与 `handleAgentStream`）。`WorkflowService` 构造函数已 `agentService.onStream` 桥接，无需新增通道。
>
> 注意点：`agentService.run` 当前有“已有请求正在执行则拒绝”的单并发限制（[agent-service.ts:254](src/main/agent-service.ts#L254)）。线性执行器顺序调用，天然不并发，无冲突；但需确认运行期间主聊天不可同时发起（或后续放宽该限制，见第 12 节）。

### 9.3 运行入口与结果展示
- 「运行」→ 收集 `seedPrompt` → `desktopAppClient.startCustomWorkflow({ workflowId, seedPrompt })`。
- 启动后**关闭设置对话框**，主控制台切换到 workflow 模式并加载该 run（复用 [use-workflow-session.ts](src/renderer/lib/hooks/use-workflow-session.ts) 的 `loadWorkflowRun` + `applyWorkflowStream` + `WorkflowConsoleView`）。
- `use-workflow-session` 需扩展：支持 `startCustomWorkflow(workflowId, seedPrompt)`，与现有 `startDebateWorkflow` / `startDeepResearchWorkflow` 平级。
- 运行中可取消（复用 `cancelWorkflow`）。
- 运行结果（各节点 assistant 消息、artifacts）在 `WorkflowConsoleView` 中按既有样式呈现。

---

## 10. 样式与 UI 一致性

- 全部新增样式追加到 [styles.css](src/renderer/styles.css)，复用既有 class：`settings-surface-card`、`settings-page-header`、`skills-list`、`skill-item`、`primary-button` / `ghost-button` / `create-button` / `edit-button` / `delete-button`、`field`、`settings-switch` 等。
- React Flow 主题适配暗色：
  - 画布背景透明或 `var(--bg-elevated)`。
  - 节点卡片用 `settings-surface-card` 风格，边框/圆角/阴影对齐 `skill-item`。
  - 边（edge）颜色用 `var(--primary)` 半透明，`smoothstep`。
  - 控件（minimap/controls）启用并覆盖配色至青蓝系；或按需关闭 minimap 保持简洁。
  - 覆盖 React Flow 默认变量：`.react-flow { background: ...; }` 等。
- 节点内智能体头像复用 `agent-avatar agent-avatar-{color}`。
- 新增类名命名遵循项目约定（语义/BEM 混合）：`workflows-panel`、`workflow-editor`、`workflow-canvas`、`workflow-node-card`、`workflow-node-agent-select`、`workflow-run-trigger`。

---

## 11. 依赖与构建

- 新增依赖：`@xyflow/react`（v12）。`npm i @xyflow/react`。
- 其 CSS：`import '@xyflow/react/dist/style.css'`（在 `WorkflowEditor` 顶部引入，再在 `styles.css` 覆盖暗色）。
- 无需改 Vite/esbuild 配置（renderer 已支持 React + CSS 引入）。
- 类型：`@xyflow/react` 自带 TS 类型，无需额外 `@types`。

---

## 12. 实施步骤清单

1. **共享类型**：新增 `src/shared/workflow-definition.ts`；在 `workflow.ts` 的 `WorkflowType` 加 `'custom'`。
2. **main 持久化**：新增 `workflow-definitions-service.ts`（镜像 agent-profiles-service）。
3. **main IPC**：新增 `workflow-definition-handlers.ts`；在 `index.ts` 注册；启动预加载。
4. **main 运行时**：在 `workflow-service.ts` 加 `createCustomRun` / `startCustomWorkflow` / `executeCustomInBackground`；注册 `workflow:run-custom` IPC。
5. **preload + client**：暴露 7 个定义方法 + `startCustomWorkflow`；`desktop-app-client.ts` 封装。
6. **设置 tab 接入**：改 `app-shell.ts`、`SettingsDialogShell.tsx`、`App.tsx`。
7. **列表页**：实现 `WorkflowsPanel.tsx`（镜像 AgentsPanel）。
8. **画布编辑器**：安装 `@xyflow/react`；实现 `WorkflowEditor.tsx` + `WorkflowNodeCard.tsx`。
9. **运行入口**：编辑器「运行」+ seedPrompt 收集；`use-workflow-session` 扩展 `startCustomWorkflow`；关闭设置 → 切主控制台展示。
10. **样式**：追加 `styles.css`，覆盖 React Flow 暗色主题。
11. **自测**：创建/编辑/删除工作流；线性多节点运行；取消；删除某 agent 后引用失效的处理（见下）。

---

## 13. 边界与已确认决策

### 13.1 已确认决策（评审通过）
1. **被引用智能体删除**（双向保护）：
   - **删除智能体时**：若该智能体已被任意工作流节点引用，删除确认弹窗中**追加提示**，列出受影响的工作流标题（如 `该智能体已被以下工作流引用：A、B，删除后相关节点将失效`）。用户确认后仍可删除，工作流定义保留 `agentId`（不级联删节点）。
   - **编辑器侧**：节点引用的 `agentId` 在当前智能体列表中找不到时，节点卡片显示「智能体已失效，请重新选择」警告态，智能体下拉强制重选。
   - **运行时**：执行到失效节点时报错并终止该 run（`status: 'failed'`，`error` 说明节点失效），不静默跳过——避免链路被截断后产生误导性输出。
   - 实现方式：删除智能体前的引用检查在**前端完成**——`AgentsPanel.handleDelete` 调 `listWorkflows()` 后本地过滤 `nodes.some(n => n.agentId === id)`，命中则在 `confirm` 文案中追加受影响列表。无需新增后端 IPC。
2. **运行期间禁用主聊天**：工作流运行中（`isWorkflowRunning`）禁用主控制台聊天发送按钮，与 `agentService.run` 单并发限制对齐；运行结束/取消后恢复。
3. **同一智能体可在链中出现多次**：节点 `agentId` 不做唯一性约束；每个节点是独立执行单元，按序各自调用。
4. **提供「打开目录」**：`WorkflowsPanel` 顶部「打开目录」按钮，调 `openWorkflowsDirectory()`，与 agents 面板一致，支持手动编辑 `workflow.json`。
5. **自定义 run 混入运行历史**：`startCustomWorkflow` 产生的 `WorkflowRun`（`type: 'custom'`）与 debate/deep_research run 一并进入 `listWorkflowRuns()` 历史，`use-workflow-session` / `WorkflowConsoleView` 统一展示与回看。

### 13.2 后续迭代（非本次范围）
- DAG / 分支 / 条件 / 循环节点。
- 节点级工具策略（复用 `WorkflowToolPolicy`）。
- 工作流导入/导出、模板库。
- `agentService.run` 并发模型重构以支持并行节点。
