# 智能体多会话支持（agent-multi-session）

## 一、需求背景与目标

当前 UI 层一个智能体只呈现一个会话，无法按聊天主题区分。目标：

1. **会话标题自动总结**：第一轮对话完成后，用模型对内容做简短总结（字数尽量短），作为会话标题
2. **聊天记录按智能体+会话隔离**：每个会话的聊天记录独立保存
3. **会话共享智能体配置**：同一智能体的所有会话共享 agent.json + AGENT.md
4. **UI**：智能体项点击下拉/收起会话列表；支持删除会话（连带删除记录）；列表末项为"新增会话"；点击智能体默认进入最近使用的会话；新智能体未建会话直接聊天时自动兜底创建

### 已确认的设计决策

| 决策点 | 结论 |
|---|---|
| "第一个会话"的定义 | 会话列表按**最近更新时间倒序**，默认进入最近使用的会话（与现有 `switchConversationScope` 行为一致） |
| 适用范围 | 普通智能体聊天（含默认智能体）+ **Code 模式工程会话**（scope 为 `code:{projectId}`）；Workflow 模式不使用会话存储，不涉及 |
| 标题生成失败回退 | 回退为现有逻辑：截取首条用户输入前 80 字作为标题 |

## 二、现状分析（评估结论）

数据层**已天然支持多会话**，本次改造后端改动极小，主要工作在 renderer：

- 会话模型 `ConversationMeta.agentId` 即 scope 字段（src/shared/conversation.ts:3-16），每个会话独立目录存储 `~/.desktop-agent/conversations/<uuid>/meta.json + segments/*.json`，聊天记录本就按会话隔离 → **需求 2 无需改持久化**
- IPC 已具备 `listConversationsByAgent` / `createConversation(agentId, title?)` / `deleteConversation(id)`（src/shared/contracts.ts:132-136），删除会话连带 `fs.rm` 磁盘目录（src/main/conversation/conversation-service.ts:258-274）→ **无需新增 IPC 通道**
- 智能体配置按 agentId 在运行时加载，与会话无关 → **需求 3 天然满足**
- "单会话"只是 UI 约束：`switchConversationScope` 永远取列表第一条（use-chat-session.ts:190-212），SidebarPanel 只列智能体不列会话（SidebarPanel.tsx:110-163）
- 标题现状为**截断**而非模型总结：agent-service.ts:586-590，首轮完成后若 title 仍为占位符 `'新会话'`，取 `prompt.slice(0, 80)`
- `run()` 结束后 renderer 会调用 `loadConversationMessages` 刷新消息（use-chat-session.ts:316），标题刷新可挂在该路径上，**无需新增事件推送通道**

## 三、技术方案

### 3.1 后端：标题自动总结（src/main/agent/agent-service.ts）

替换 agent-service.ts:586-590 的截断逻辑。`run()` 的无工具调用分支（即首轮完成的收尾点）中：

```ts
// 现状
const meta = conversationService.getConversationMeta(conversationId);
if (meta && meta.title === '新会话') {
  await conversationService.updateConversationTitle(conversationId, prompt.slice(0, 80));
}

// 改为
const meta = conversationService.getConversationMeta(conversationId);
if (meta && meta.title === '新会话') {
  const title = await generateConversationTitle(prompt, assistantMessage.content ?? '');
  await conversationService.updateConversationTitle(conversationId, title);
}
```

新增模块级函数 `generateConversationTitle(firstPrompt, assistantReply)`：

- 复用 `createChatCompletion`（与 conversation-service.ts:380-434 `summarizeConversation` 同款非流式调用）
- system 提示词要求："用不超过 20 个字总结这段对话的主题，作为会话标题，直接输出标题本身，不加引号、句号或任何前缀"
- messages 只含**一条 user 消息**（内容为首轮用户输入 + 助手回复拼接，超长截断），避免空 assistant 消息触发 GLM 网关校验问题（commit 09c4a45 的坑）
- 结果 `slice(0, 30)` 兜底；空结果视为失败
- 整体 try/catch，任何异常回退为 `firstPrompt.slice(0, 80)`（已确认的回退策略）

关键性质：

- **同步 await 于 run() 内**：标题生成只发生在每个会话的第一轮完成时（一次性的 ~1-2 秒延迟，且此时回复已流式渲染完），换取确定性——run 返回后 renderer 刷新即可拿到新标题，无需新增事件通道
- **仅触发一次**：`title === '新会话'` 守卫
- **Code 模式自动生效**：Code 请求同样走 `agentService.run()`（内置 Code 提示词），其会话标题自动总结，无需额外代码

### 3.2 前端：会话列表状态与操作（src/renderer/lib/hooks/use-chat-session.ts）

新增状态与函数（`ConversationListItem` 类型已存在于 src/shared/conversation.ts:18-27）：

```ts
const [conversationList, setConversationList] = useState<ConversationListItem[]>([]);

// 刷新当前 scope 的会话列表（switchConversationScope 内已有 listConversationsByAgent 调用，保存其结果即可）
async function refreshConversationList(scopeKey: string): Promise<ConversationListItem[]>

// 切换会话：设置 activeConversationId 并加载消息
async function handleSelectConversation(conversationId: string): Promise<void>

// 新增会话：createConversation(scopeKey) → 激活 + 刷新列表（执行期间禁用按钮防连点）
async function handleCreateConversation(): Promise<void>

// 删除会话：deleteConversation → 若删的是激活会话：
//   列表剩余取最近更新的一个切换；列表为空则 createConversation 兜底
//   → 刷新列表
async function handleDeleteConversation(conversationId: string): Promise<void>
```

修改点：

- `switchConversationScope`（:190-212）：将 `listConversationsByAgent` 结果写入 `conversationList`；无会话自动创建的逻辑保留（需求 5 兜底）
- `handleRunAgent`（:239-332）：`!conversationId` 时不再直接报错，改为先用当前 scope `createConversation` 再继续执行（需求 5：新智能体未建会话直接聊天）
- run 完成后（:316 `loadConversationMessages` 处）追加 `refreshConversationList`，让首轮生成的新标题及时显示在下拉列表中

### 3.3 前端：侧边栏 UI（src/renderer/features/layout/SidebarPanel.tsx + App.tsx + styles.css）

**SidebarPanel 改造**（智能体 tab 与 Code tab 同一套结构）：

- 智能体项 / Code 工程项由单一 `<button>` 改为"可展开项"：
  - 点击行为 = `onSelectAgent/onSelectCodeProject`（切换 scope，自动进最近会话）+ 通知 App 设置 `expandedScopeKey`；再次点击同一项仅收起（`expandedScopeKey = null`，不改变当前激活会话）
  - 展开指示图标（chevron）
- 展开区渲染会话列表（数据来自 `conversationList`）：
  - 每项：标题 + meta（消息数 · 更新时间短格式），激活会话高亮
  - 每项 hover 显示删除按钮（`stopPropagation`），点击弹确认后调 `onDeleteConversation`；**isRunning 时激活会话的删除按钮禁用**
  - **末项固定为"+ 新增会话"**，点击调 `onCreateConversation`
- App.tsx 新增 `expandedScopeKey` state；`handleAgentSelection` / `handleCodeProjectSelection` 成功后设置展开项；将 `conversationList`、`isRunning`、各回调传入 SidebarPanel

**样式**（src/renderer/styles.css）：新增会话下拉列表容器、会话项、删除按钮、新增项样式，视觉沿用现有 `app-agent-item` / `app-workflow-item` 体系。

### 3.4 数据流

```
聊天主链路（不变）：
输入 → runAgent(conversationId) → agentService.run() → setMessages(该会话目录) → renderer 重载消息

标题生成链路（新增，首轮一次）：
run() 无工具调用分支 → generateConversationTitle(模型调用, 失败回退截断)
  → updateConversationTitle(meta.json) → renderer run 结束回调 → refreshConversationList → 下拉显示新标题

会话切换链路：
点击会话项 → handleSelectConversation → setActiveConversationId → getConversationMessagesPage → 渲染

删除链路：
确认 → conversation:delete IPC → fs.rm 目录 + 内存 Map 删除 → 刷新列表（激活会话被删则自动切换/新建）
```

## 四、受影响文件

| 文件 | 类型 | 影响内容 |
|---|---|---|
| e:\my-project\desktop-tools\src\main\agent\agent-service.ts | 修改 | `run()` :586-590 标题逻辑替换；新增 `generateConversationTitle` |
| e:\my-project\desktop-tools\src\renderer\lib\hooks\use-chat-session.ts | 修改 | 会话列表状态；`handleSelectConversation` / `handleCreateConversation` / `handleDeleteConversation`；`switchConversationScope`、`handleRunAgent` 兜底；run 后刷新列表 |
| e:\my-project\desktop-tools\src\renderer\App.tsx | 修改 | `expandedScopeKey` 状态与回调接线；SidebarPanel 新 props |
| e:\my-project\desktop-tools\src\renderer\features\layout\SidebarPanel.tsx | 修改 | 智能体/工程项可展开 + 会话下拉列表 UI |
| e:\my-project\desktop-tools\src\renderer\styles.css | 修改 | 会话列表样式 |
| e:\my-project\desktop-tools\src\main\agent\agent-service.test.ts（新增） | 新增 | `generateConversationTitle` 回退逻辑单测（提取可测的提示词构造/结果清洗纯函数） |

不需要改动：shared 类型与 contracts（无新增 IPC）、conversation-service（持久化与删除已完备）、preload。

## 五、边界条件与异常处理

1. **标题模型调用失败 / 超时 / 空返回**：回退截断首句（已确认）；`updateConversationTitle` 自身限 100 字
2. **标题重复生成**：仅 `title === '新会话'` 时触发；用户手动改过标题后不再自动生成（沿用现状守卫语义）
3. **删除激活会话**：自动切换到列表中下一个（最近更新）会话；列表为空则自动新建——与需求 5 行为一致
4. **运行中保护**：isRunning 时禁用"删除激活会话"与"同智能体内切换会话"，避免流式事件写入已删除会话或串视图；运行中点击其他智能体的现状行为保持不变
5. **新增会话按钮防抖**：创建请求进行中禁用，避免连点创建多个
6. **新智能体未建会话直接聊天**：`handleRunAgent` 兜底创建（需求 5）
7. **App 启动 `ensureDefaultConversation`**（App.tsx:185-194）：保留，已有"存在则复用"判断，不会重复创建
8. **Code 模式**：会话 scope `code:{projectId}`，下拉组件复用；移除工程时级联删除该 scope 全部会话（code-project-handlers.ts:33 现有逻辑，不受影响）
9. **删除智能体**：级联删除其会话（agent-profile-handlers.ts:32 现有逻辑，不受影响）
10. **Workflow 模式**：不使用会话存储，完全不受影响
11. **附件与审计日志**：按 conversationId 关联，多会话下天然隔离
12. **自动上下文摘要**（`shouldSummarize`/`summarizeConversation`）：按会话独立运行，与标题生成互不干扰

## 六、预期结果

1. 同一智能体（含默认智能体与 Code 工程）可建多个会话，各会话聊天记录独立保存、互不可见
2. 首轮对话完成后会话标题自动变为 ≤20 字的主题总结（失败时为首句截断），且不再变化
3. 侧边栏点击智能体/工程展开会话列表，再点收起；列表末项"新增会话"；每项可删除（连带磁盘记录）；默认进入最近使用的会话
4. 新智能体开箱即聊（自动建会话）；删除全部会话后再聊也自动新建
5. `npm run typecheck` 与 `npm test` 通过

## 七、增量需求：会话标题支持手动编辑（Task 7）

### 需求场景

当前会话标题由模型在首轮总结生成，用户无法修改。需要支持在侧边栏会话列表中直接编辑标题。

### 技术方案

**后端（复用现有能力，仅补 IPC）**：
- `conversationService.updateConversationTitle`（conversation-service.ts:346）已存在且会发射 `conversation:changed` 事件（Task 5 引入），无需改动
- 新增 IPC `conversation:rename`：入参 `(conversationId, title)`，先 `getConversationMeta` 校验会话存在，再调 `updateConversationTitle`，返回 `ConversationOperationResult`

**协议层（按架构规则四层同步）**：
- contracts.ts 增加 `renameConversation: (conversationId: string, title: string) => Promise<ConversationOperationResult>`
- preload/index.ts 增加 `conversation:rename` 的 invoke 透传
- desktop-app-client.ts 增加 facade 方法

**渲染层**：
- use-chat-session.ts 新增 `handleRenameConversation(conversationId, title)`：空标题不提交；调用 IPC，失败设置 `lastError`；成功后无需手动刷新列表——`conversation:changed` 推送事件的既有订阅会就地更新 `conversationList` 中对应项标题（Task 5 已实现）
- SidebarPanel.tsx：会话项 hover 时在删除按钮旁显示编辑按钮（Pencil 图标，`stopPropagation`）；点击或双击标题进入编辑态（本地 state：`editingConversationId` + 标题草稿），渲染为单行 input：Enter/失焦提交、Esc 取消、`maxLength=100`；编辑态互斥（同时只编辑一个会话）
- styles.css：编辑 input 样式，视觉与 meta 行对齐
- App.tsx：接线 `onRenameConversation` → `handleRenameConversation`

### 数据流

```
编辑按钮/双击 → SidebarPanel 编辑态 → Enter → onRenameConversation
  → conversation:rename IPC → 校验存在 → updateConversationTitle（截断 100 字 + meta.json 落盘）
  → emitConversationChanged → index.ts 推送 conversation:changed
  → use-chat-session 订阅回调 → 就地更新 conversationList 标题
```

### 边界条件与异常处理

1. **空标题/纯空白**：renderer 校验不提交，退出编辑态保持原标题
2. **长度**：input `maxLength=100`；后端 `updateConversationTitle` 兜底截断 100
3. **会话不存在**（列表过期/并发删除）：返回 `{ok: false, error}`，UI 提示并刷新列表
4. **重命名与自动标题的关系**：用户改过名后 title ≠ '新会话'，自动总结守卫自然不再覆盖——用户命名优先，语义沿用现状
5. **isRunning 时允许重命名**：仅写 meta.json，不触碰消息历史与运行状态
6. **编辑期间的列表刷新**（如推送事件到达）：编辑态以 `editingConversationId` 为准，若该会话仍在列表中则保留草稿，否则退出编辑态

### 受影响文件

| 文件 | 类型 | 影响内容 |
|---|---|---|
| e:\my-project\desktop-tools\src\main\conversation\conversation-handlers.ts | 修改 | 新增 `conversation:rename` handler |
| e:\my-project\desktop-tools\src\shared\contracts.ts | 修改 | 新增 `renameConversation` 声明 |
| e:\my-project\desktop-tools\src\preload\index.ts | 修改 | 新增 rename 透传 |
| e:\my-project\desktop-tools\src\renderer\lib\desktop\desktop-app-client.ts | 修改 | 新增 facade 方法 |
| e:\my-project\desktop-tools\src\renderer\lib\hooks\use-chat-session.ts | 修改 | 新增 `handleRenameConversation` |
| e:\my-project\desktop-tools\src\renderer\features\layout\SidebarPanel.tsx | 修改 | 编辑按钮、双击进入编辑态、input 提交/取消逻辑 |
| e:\my-project\desktop-tools\src\renderer\styles.css | 修改 | 编辑 input 样式 |
| e:\my-project\desktop-tools\src\renderer\App.tsx | 修改 | 接线 onRenameConversation |

### 预期结果

1. 会话项 hover 出现编辑按钮，点击或双击标题进入编辑，Enter/失焦保存、Esc 取消
2. 改名后下拉列表立即显示新标题；重开应用后标题保持
3. 用户改过的标题不会被模型自动总结覆盖
4. typecheck 与 npm test 通过
