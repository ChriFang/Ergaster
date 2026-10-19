# 智能体功能设计方案

## 功能概述
为桌面应用新增“智能体”管理能力，支持在菜单中打开智能体管理弹窗，对本地智能体进行新增、删除、编辑，并在左侧边栏展示可选智能体。用户发送消息时，若已选择某个智能体，则将该智能体内容作为预置提示词一并发送给模型；UI 仅展示用户输入内容，不展示注入的智能体内容。

## 当前现状分析

### 现有入口与界面
- 顶部下拉菜单定义在 `e:\other-code\desktop-tools\src\renderer\App.tsx:353`，当前已有 `Skills 管理`、`设置`、`关于`。
- 左侧边栏“智能体”区域目前只有静态占位 `默认智能体`，位于 `e:\other-code\desktop-tools\src\renderer\App.tsx:321`。
- Skills 管理弹窗由 `e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx:10` 和 `SkillEditor.tsx:10` 实现，可复用其 CRUD 交互模式。

### 现有模型调用链路
- 前端发送入口在 `e:\other-code\desktop-tools\src\renderer\App.tsx:242`，调用 `window.desktopApp.runAgent({ prompt })`。
- IPC 暴露在 `e:\other-code\desktop-tools\src\preload\index.ts:6`。
- 主进程请求入口在 `e:\other-code\desktop-tools\src\main\index.ts:61`。
- Agent 组装消息逻辑在 `e:\other-code\desktop-tools\src\main\agent-service.ts:25`，当前只把 `prompt` 作为一条 user message 追加到会话。
- DeepSeek 请求发送在 `e:\other-code\desktop-tools\src\main\deepseek-client.ts:31`，直接把 `messages` 透传给接口。

### 现有本地持久化能力
- 用户自定义 Skills 本地扫描、读写、重载、删除能力已在 `e:\other-code\desktop-tools\src\main\user-skills-service.ts:12` 中实现。
- Skills IPC 在 `e:\other-code\desktop-tools\src\main\skill-handlers.ts:5` 注册。
- 这套模式很适合抽象出“智能体”版本：本地目录扫描 + 内存缓存 + IPC CRUD + 弹窗管理。

## 需求拆解与处理逻辑

### 场景一：菜单新增“智能体”入口，点击后弹窗管理
**目标**
- 在下拉菜单中新增“智能体”项。
- 点击后弹出智能体设置界面。
- 打开界面时扫描本地已保存智能体，并按列表展示。

**处理逻辑**
1. 在 `App.tsx` 中新增 `showAgentsModal` 状态。
2. 在下拉菜单插入“智能体”按钮，点击后打开新弹窗。
3. 弹窗内部使用新的 `AgentsPanel` 组件，在 `useEffect` 中调用 `listAgents()` 加载本地智能体。
4. 主进程提供 `agent-profile:list` 或类似 IPC，从本地目录扫描并返回列表数据。
5. 若目录不存在，则自动创建并返回空列表，不报错。

**预期结果**
- 用户可通过菜单进入智能体管理。
- 打开即显示当前本地智能体列表，无需手动刷新。

### 场景二：新增/删除/编辑智能体
**目标**
- 支持创建智能体。
- 支持删除智能体。
- 支持编辑智能体标题与智能体主体内容。
- 保存后同步更新左侧边栏显示。

**处理逻辑**
1. 智能体数据模型建议最小化为：
   - `id`：稳定标识，建议使用目录名。
   - `title`：展示名称。
   - `content`：注入模型的预置提示词正文。
   - `createdAt` / `updatedAt`：列表展示和排序可用。
2. 本地存储建议采用每个智能体一个目录，目录内固定文件名，例如：
   - `AGENT.md`：保存主体内容。
   - `agent.json`：保存标题等元信息。
3. 创建时：
   - 根据标题生成安全目录名（kebab-case），若冲突则追加序号。
   - 写入 `agent.json` 与 `AGENT.md`。
4. 编辑时：
   - 允许修改标题与内容。
   - 若标题变化，不强制重命名目录，避免引用和选择状态抖动；仅更新元信息文件中的 `title`。
   - 若后续需要“目录名随标题变化”，可作为独立增强项，不放入首版。
5. 删除时：
   - 删除对应目录。
   - 如果当前选中智能体被删除，则自动回退到“默认无智能体”状态。

**预期结果**
- 智能体变更后，弹窗列表和左侧边栏保持一致。
- 本地文件完整保存标题与正文。

### 场景三：左侧边栏展示智能体标题并支持选择
**目标**
- 左侧边栏展示已加载智能体标题列表。
- 用户点击某个智能体后进入选中状态。
- 允许切换到“未选择智能体/默认模式”。

**处理逻辑**
1. 在 `App.tsx` 中维护：
   - `agents`
   - `selectedAgentId`
2. 边栏列表从静态项改为动态渲染。
3. 增加一个固定项，如“默认模式”或“无智能体”，用于清除选择。
4. 当前选中项使用明显高亮样式。
5. 管理弹窗保存、删除后，刷新 `agents` 并校正 `selectedAgentId`。

**预期结果**
- 左侧边栏可以直接完成智能体切换。
- 当前对话发送行为明确依赖当前选中项。

### 场景四：发送消息时注入智能体内容，但 UI 不显示
**目标**
- 用户选择智能体后，输入框中只输入自己的提示词。
- 发给模型时，将智能体正文作为预置提示词一起发送。
- 对话 UI 仅显示用户输入部分，不显示智能体内容。

**处理逻辑**
1. 扩展 `AgentRunInput`，新增 `agentId?: string` 或 `selectedAgentId?: string` 字段。
2. 前端发送时：
   - `App.tsx:264` 调用 `runAgent({ prompt, agentId: selectedAgentId ?? undefined })`。
   - UI 仍只执行 `setMessages((current) => [...current, { role: 'user', content: prompt }])`，不拼接智能体内容。
3. 主进程 `agent-service.ts` 中：
   - 在执行 `workingMessages` 组装前，根据 `agentId` 查出智能体内容。
   - 将智能体内容包装为 `system` message 插入本轮请求消息序列中。
4. 注入方式建议：
   - 不把 system message 持久化到 `this.messages` 对外展示列表中。
   - 每次 run 时构建“请求消息副本”：`requestMessages = [system(agent), ...history, user(prompt)]`。
   - 真正持久化到会话历史的仍然只有用户消息、模型消息、工具消息。
5. 如果后续需要“同一会话切换智能体后仍保持历史一致性”，建议按“当前发送时生效”的语义处理，不回写历史。

**预期结果**
- 模型实际收到智能体预置提示词。
- 前端消息列表不会泄露智能体正文。
- 切换智能体只影响后续发送，不篡改既有消息 UI。

## 架构设计

### 数据结构建议
新增共享类型文件，例如 `src/shared/agent-profile.ts`：

```ts
export type AgentProfileListItem = {
  id: string;
  title: string;
  directoryName: string;
  directoryPath: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentProfileDetail = {
  id: string;
  title: string;
  content: string;
  directoryName: string;
  directoryPath: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateAgentProfileRequest = {
  title: string;
  content: string;
};

export type UpdateAgentProfileRequest = {
  id: string;
  title: string;
  content: string;
};
```

并扩展 `e:\other-code\desktop-tools\src\shared\agent.ts:33`：

```ts
export type AgentRunInput = {
  prompt: string;
  agentId?: string;
};
```

### 本地文件组织建议
建议新增目录：
- Windows 用户目录下：`%USERPROFILE%/.desktop_tools/agents/`
- 每个智能体一个子目录，例如：`meeting-assistant/`

目录结构示例：

```text
.desktop_tools/
  agents/
    meeting-assistant/
      agent.json
      AGENT.md
```

`agent.json` 示例：

```json
{
  "id": "meeting-assistant",
  "title": "会议纪要助手",
  "createdAt": "2026-05-25T10:00:00.000Z",
  "updatedAt": "2026-05-25T10:30:00.000Z"
}
```

`AGENT.md` 示例：

```md
你是一个会议纪要助手。
请将用户输入整理为结构化纪要，包含议题、结论、待办事项和负责人。
```

### 主进程服务建议
参考 `user-skills-service.ts` 新增 `agent-profiles-service.ts`，职责如下：
- 扫描本地智能体目录
- 加载列表与详情
- 创建/更新/删除智能体
- 根据 `id` 返回可注入模型的正文内容

关键接口建议：

```ts
class AgentProfilesService {
  getAgentsDirectory(): string;
  scanAndLoadAgents(): Promise<void>;
  getAgentListItems(): AgentProfileListItem[];
  getAgentDetail(id: string): AgentProfileDetail | null;
  getAgentContent(id: string): string | null;
  createAgent(request: CreateAgentProfileRequest): Promise<OperationResult>;
  updateAgent(request: UpdateAgentProfileRequest): Promise<OperationResult>;
  deleteAgent(id: string): Promise<OperationResult>;
  reloadAgents(): Promise<void>;
}
```

### IPC 设计建议
在 `preload/index.ts` 与 `shared/contracts.ts` 中新增：
- `listAgents()`
- `getAgent(id)`
- `createAgent(request)`
- `updateAgent(request)`
- `deleteAgent(id)`
- `reloadAgents()`
- `getAgentsDirectory()`
- `openAgentsDirectory()`

在主进程新增 `agent-profile-handlers.ts` 注册对应 IPC。

### 前端界面建议
新增组件：
- `src/renderer/features/agents/AgentsPanel.tsx`
- `src/renderer/features/agents/AgentEditor.tsx`

交互尽量复用 Skills 管理模式：
- 列表页：展示标题、更新时间、编辑/删除按钮
- 编辑页：
  - 标题输入框
  - 主体内容 textarea
  - 保存 / 取消

左侧边栏改造建议：
- 在 `App.tsx` 中加载智能体列表
- 点击项更新 `selectedAgentId`
- 在 `Composer` 上方或边栏标题旁显示“当前智能体：xxx”可作为轻量增强

## 受影响文件清单

### 必改文件
1. `e:\other-code\desktop-tools\src\renderer\App.tsx`
   - 新增智能体状态、弹窗入口、边栏列表、发送时传入 `agentId`
2. `e:\other-code\desktop-tools\src\shared\agent.ts`
   - 扩展 `AgentRunInput`
3. `e:\other-code\desktop-tools\src\shared\contracts.ts`
   - 扩展 `DesktopAppApi` 与智能体详情类型
4. `e:\other-code\desktop-tools\src\preload\index.ts`
   - 暴露智能体 IPC API
5. `e:\other-code\desktop-tools\src\main\index.ts`
   - 注册智能体 handlers，并在应用启动时加载智能体
6. `e:\other-code\desktop-tools\src\main\agent-service.ts`
   - 在发送请求时注入选中智能体的 system message，但不暴露到 UI message history
7. `e:\other-code\desktop-tools\src\renderer\styles.css`
   - 增加智能体弹窗、列表项、选中状态样式

### 建议新增文件
1. `e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`
   - 本地扫描与持久化
2. `e:\other-code\desktop-tools\src\main\agent-profile-handlers.ts`
   - IPC handlers
3. `e:\other-code\desktop-tools\src\shared\agent-profile.ts`
   - 智能体共享类型
4. `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`
   - 智能体管理面板
5. `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
   - 智能体编辑器

## 数据流路径

### 智能体列表加载
1. `App.tsx` / `AgentsPanel.tsx` 调用 `window.desktopApp.listAgents()`
2. `preload/index.ts` 转发到 IPC
3. `agent-profile-handlers.ts` 调用 `agent-profiles-service.ts`
4. 服务扫描本地目录并返回列表
5. 前端渲染边栏与弹窗列表

### 智能体编辑保存
1. 用户在 `AgentEditor` 输入标题和正文
2. 前端调用 `createAgent` 或 `updateAgent`
3. 主进程写入 `agent.json` + `AGENT.md`
4. 返回成功后前端刷新列表
5. `App.tsx` 同步更新左侧边栏

### 发送消息
1. 用户在边栏选择智能体
2. `App.tsx` 发送 `runAgent({ prompt, agentId })`
3. `agent-service.ts` 根据 `agentId` 查询正文
4. 构造请求消息：`[system(agent content), ...history, user(prompt)]`
5. `deepseek-client.ts` 把该消息序列发给模型
6. UI 仅展示用户 prompt 和模型回复

## 边界条件与异常处理
- 智能体目录不存在：自动创建，前端显示空列表。
- 标题为空：前端禁止保存。
- 内容为空：前端禁止保存。
- 同名目录冲突：创建时自动追加 `-2`、`-3` 后缀，避免失败。
- 当前选中智能体被删除：自动切回“默认模式”。
- 指定 `agentId` 不存在：忽略注入并继续发送，避免整次对话失败；同时记录主进程日志。
- 智能体内容过长：首版不做截断，但建议在后续加入长度提示。
- 切换智能体后继续对话：仅影响后续请求，不修改历史消息显示。
- 打开管理面板时目录中有外部新增/删除：调用 `reloadAgents()` 或每次面板打开时重新扫描，保证读取最新本地状态。

## 安全与实现注意点
- 智能体正文属于本地提示词资产，不应直接展示到聊天记录中，避免误泄露。
- 目录名必须做安全归一化，避免非法路径字符和路径穿越问题。
- 文件写入统一使用主进程完成，renderer 不直接访问文件系统。
- 删除操作应加二次确认。
- 若内容保存为 Markdown，发送给模型时建议取原文文本，不拼接多余展示性包装。

## 可选优化建议
以下是建议一并确认的增强项：
1. **增加“默认模式”固定项**：允许用户明确切回无智能体模式。
2. **边栏显示当前选中态**：避免用户不知道当前发送附带了哪个智能体。
3. **面板打开自动重扫本地目录**：支持用户手工修改本地文件后立即生效。
4. **创建时自动生成目录名**：标题可中文展示，目录名内部自动转 slug，避免强制用户输入技术化名称。
5. **后续可增加导入/导出**：首版先不做，避免扩大范围。

## 待确认问题
为避免实现偏差，下面几点建议确认：
1. **左侧边栏是否需要“默认模式/无智能体”固定项？**
   - 建议：需要，便于用户主动关闭智能体注入。
2. **本地保存格式是否接受“两文件方案（agent.json + AGENT.md）”？**
   - 建议：接受。标题和内容职责清晰，后续扩展字段更容易。
3. **智能体标题是否允许重名？**
   - 建议：允许标题重名，但内部目录 `id` 唯一；如果你希望标题也唯一，需要在保存时校验。
4. **编辑标题后是否要求重命名目录？**
   - 建议：首版不重命名目录，仅更新标题，稳定性更好。
5. **智能体注入方式是否接受作为 `system` message 插入到每次请求顶部？**
   - 建议：接受，这是最符合“预置提示词”的实现方式。

## 结论
建议基于现有 Skills 管理架构平行扩展一套 Agent Profiles 管理能力，以最小改动实现：
- 菜单新增“智能体”入口
- 弹窗内完成本地智能体 CRUD
- 左侧边栏动态展示并选择智能体
- 发送时把选中智能体内容作为 system prompt 注入
- 聊天 UI 不展示注入内容

该方案与当前代码结构匹配度高，复用现有 Electron IPC、主进程文件服务和弹窗 UI 模式，落地成本较低，且后续可平滑扩展导入导出、启用禁用、分类等能力。