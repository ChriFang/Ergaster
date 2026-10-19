# 智能体关联 Skill 运行时生效方案

## 背景与目标

当前智能体编辑中，“关联 Skills”在 UI 上可展示、选择和保存，但运行时逻辑未使用智能体配置中的 `skillNames`，导致关联关系不影响实际工具暴露与调用。

本方案目标：让智能体关联的 Skill 在实际对话运行中生效，使不同智能体只获得自身关联的 Skill 能力，同时保持未选择智能体时的全局 Skill 行为不变。

## 现状分析

### 已生效的链路

1. UI 编辑页支持选择 Skills。
   - 文件：`e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
   - 关键逻辑：`skillNames` state、`toggleSkill(skillName)`、保存 payload 中携带 `skillNames`。

2. 智能体保存链路已持久化 `skillNames`。
   - 文件：`e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`
   - 关键函数：
     - `createAgent(request)`：将 `request.skillNames` 写入 `agent.json`。
     - `updateAgent(request)`：更新 `agent.json` 中的 `skillNames`。
     - `getAgentDetail(id)`：返回 `skillNames`。

3. 共享类型已定义 `skillNames`。
   - 文件：`e:\other-code\desktop-tools\src\shared\agent-profile.ts`
   - 涉及类型：
     - `AgentProfileListItem`
     - `AgentProfileDetail`
     - `CreateAgentProfileRequest`
     - `UpdateAgentProfileRequest`
     - `AgentProfileMetadata`

### 未生效的运行时链路

运行时工具列表由 `tool-registry.ts` 生成：

- 文件：`e:\other-code\desktop-tools\src\main\tool-registry.ts`
- 当前关键函数：
  - `getUserTools()`：无条件将所有已加载用户 Skill 转成 runtime tools。
  - `getMcpToolDefinitions(agentId)`：会读取智能体的 `mcp.enabledServerNames`，因此 MCP 关联已经按智能体生效。
  - `getRuntimeTools(agentId)`：组合 system tools、所有 skill tools、MCP tools。
  - `executeToolCall(toolCall, signal, { agentId })`：执行前重新获取 runtime tools，但仍然没有按 `skillNames` 限制 Skill。

当前代码核心问题：

```ts
async function getUserTools(): Promise<ToolDefinition<unknown>[]> {
  return Array.from(userSkillDefinitions.values()).map((skill) => ({
    name: skill.metadata.name,
    description: skill.metadata.description,
    source: {
      type: 'skill',
      skillName: skill.metadata.name,
    },
    execute: async () => ({ ok: true, content: '' }),
  }));
}

async function getRuntimeTools(agentId?: string): Promise<ToolDefinition<unknown>[]> {
  const skillTools = await getUserTools();
  const mcpTools = await getMcpToolDefinitions(agentId);
  return [...registeredTools, ...skillTools, ...mcpTools];
}
```

因此：

- 选择了某个智能体时，`AGENT.md` system prompt 生效。
- 选择了某个智能体时，`mcp.enabledServerNames` 生效。
- 选择了某个智能体时，`skillNames` 不生效。

## 设计原则

1. 最小改动：复用现有 `skillNames` 数据模型和 UI，不新增复杂配置。
2. 和 MCP 绑定语义保持一致：选择智能体后，运行时只暴露该智能体显式关联的外部扩展能力。
3. 安全默认：智能体不存在时不暴露 agent-scoped MCP，也不暴露 agent-scoped Skill。
4. 保持全局对话兼容：未选择智能体时，仍使用全局已加载 Skills，避免破坏当前默认助手能力。
5. 双重约束：不仅模型可见 tools 要过滤，实际执行 `executeToolCall` 时也要基于同一套 runtime tools 再次拦截，防止模型或历史消息请求未授权 Skill。

## 功能语义

### 未选择智能体

- `agentId` 为空。
- 系统工具：全部可用。
- 用户 Skills：全部已加载 Skills 可用。
- MCP：全局启用 MCP 可用，即当前 `mcpService.getEnabledMcpToolDefinitions()` 行为。

### 选择智能体

- `agentId` 非空且能找到智能体详情。
- 系统工具：全部可用。
- 用户 Skills：仅 `agent.skillNames` 中列出的、且当前已加载的 Skills 可用。
- MCP：仅 `agent.mcp.enabledServerNames` 对应的 MCP tools 可用。

### 智能体不存在

- 系统工具：全部可用。
- 用户 Skills：不暴露。
- MCP：不暴露。
- 这样与当前 MCP 逻辑一致，避免错误 agentId 意外获得全局扩展能力。

### 智能体关联了不存在或已删除的 Skill

- 忽略该 Skill，不注册为 tool。
- 不中断对话。
- 可选记录主日志，便于后续排查，但不向用户暴露内部异常。

## 技术方案

### 方案核心

在 `tool-registry.ts` 中让 `getUserTools` 接收 `agentId`，并根据智能体详情过滤 Skill。

建议新增一个辅助函数，统一获得 agent-scoped skill names：

```ts
function getAgentSkillNameSet(agentId?: string): Set<string> | null {
  const targetAgentId = agentId?.trim();
  if (!targetAgentId) {
    return null;
  }

  const detail = agentProfilesService.getAgentDetail(targetAgentId);
  if (!detail) {
    return new Set();
  }

  return new Set(detail.skillNames.map((name) => name.trim()).filter(Boolean));
}
```

语义说明：

- 返回 `null`：未选择智能体，不过滤 Skills。
- 返回空 Set：选择了智能体但无关联 Skill，或智能体不存在，不暴露任何 Skill。
- 返回非空 Set：只暴露集合内的 Skills。

然后修改 `getUserTools`：

```ts
async function getUserTools(agentId?: string): Promise<ToolDefinition<unknown>[]> {
  const allowedSkillNames = getAgentSkillNameSet(agentId);

  return Array.from(userSkillDefinitions.values())
    .filter((skill) => allowedSkillNames === null || allowedSkillNames.has(skill.metadata.name))
    .map((skill) => ({
      name: skill.metadata.name,
      description: skill.metadata.description,
      risk: 'low',
      strict: true,
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      } as ToolSchemaShape,
      validator: z.object({}).passthrough(),
      source: {
        type: 'skill',
        skillName: skill.metadata.name,
      },
      execute: async () => ({
        ok: true,
        content: '',
      }),
    }));
}
```

然后修改 `getRuntimeTools`：

```ts
async function getRuntimeTools(agentId?: string): Promise<ToolDefinition<unknown>[]> {
  const skillTools = await getUserTools(agentId);
  const mcpTools = await getMcpToolDefinitions(agentId);
  return [...registeredTools, ...skillTools, ...mcpTools];
}
```

由于 `executeToolCall` 已经调用 `getRuntimeTools(input?.agentId)`，执行侧会自动继承过滤结果：

```ts
export async function executeToolCall(
  toolCall: ToolCall,
  signal: AbortSignal,
  input?: { agentId?: string; allowedToolNames?: string[]; requireConfirmation?: boolean },
): Promise<ChatCompletionApiMessage> {
  const runtimeTools = await getRuntimeTools(input?.agentId);
  // 后续 runtimeToolMap 只包含当前智能体允许的 Skill。
}
```

这能同时解决：

- 模型 tools 列表中不出现未关联 Skill。
- 即使历史上下文里存在未关联 Skill 的 tool call，也会返回 `未知工具`，不会执行。

## 受影响文件

### 必改文件

1. `e:\other-code\desktop-tools\src\main\tool-registry.ts`
   - 修改类型：运行时逻辑修改。
   - 受影响函数：
     - `getUserTools()`：改为 `getUserTools(agentId?: string)`，按 `agentProfilesService.getAgentDetail(agentId)?.skillNames` 过滤。
     - `getRuntimeTools(agentId?: string)`：传递 `agentId` 给 `getUserTools`。
   - 新增函数：
     - `getAgentSkillNameSet(agentId?: string): Set<string> | null`。

### 建议增加或检查的验证点

当前项目未发现测试脚本，`package.json` 提供：

- `npm run typecheck`
- `npm run build`

建议实现后至少运行：

```bash
npm run typecheck
```

如时间允许再运行：

```bash
npm run build
```

## 数据流路径

### 编辑保存路径

1. `AgentEditor.tsx` 中用户点击 Skill chip。
2. `toggleSkill(skill.name)` 更新 `skillNames`。
3. 保存时 payload 携带 `skillNames`。
4. `AgentsPanel.tsx` 调用 `window.desktopApp.createAgent/updateAgent`。
5. `agent-profile-handlers.ts` IPC 传到 `agentProfilesService.createAgent/updateAgent`。
6. `agent-profiles-service.ts` 写入 `agent.json`。

该路径已有，不需要本次修改。

### 运行时路径

1. `use-chat-session.ts` 调用 `desktopAppClient.runAgent({ prompt, agentId })`。
2. `agent-service.ts` 的 `run(input)` 读取 `agentId`。
3. `getRegisteredToolsForAgent({ agentId })` 获取模型可见 tools。
4. `tool-registry.ts` 中：
   - 系统 tools 始终加入。
   - `getUserTools(agentId)` 按 `agent.skillNames` 过滤 Skill tools。
   - `getMcpToolDefinitions(agentId)` 按 `agent.mcp.enabledServerNames` 过滤 MCP tools。
5. 模型只能看到过滤后的 Skill tools。
6. 模型发起 tool call 时，`executeToolCall(toolCall, signal, { agentId })` 再次使用同一过滤逻辑生成 `runtimeToolMap`。
7. 未授权 Skill 不在 `runtimeToolMap` 中，因此不会执行。

## 边界条件与异常处理

1. `agentId` 为空：返回全部用户 Skills，保持当前全局助手行为。
2. `agentId` 对应智能体不存在：返回空 Skill 集合，不暴露用户 Skills。
3. `skillNames` 为空数组：该智能体不暴露任何用户 Skills。
4. `skillNames` 包含空字符串：通过 trim/filter 忽略。
5. `skillNames` 包含重复项：Set 自动去重。
6. `skillNames` 包含未加载 Skill：过滤后不存在该 tool，不报错。
7. Skill 在对话期间被删除或重载：执行侧重新计算 runtime tools，未授权或不存在的 Skill 不会执行。

## 预期结果

1. 智能体 A 只关联 Skill X 时：
   - 使用智能体 A 对话，模型 tools 中只包含系统工具、Skill X、A 关联的 MCP tools。
   - Skill Y 不会暴露给模型，也不能被执行。

2. 智能体 B 未关联任何 Skill 时：
   - 使用智能体 B 对话，模型 tools 中不包含任何用户 Skill。
   - 系统工具仍可用。
   - B 关联的 MCP tools 仍按原逻辑可用。

3. 未选择智能体时：
   - 所有已加载用户 Skills 仍可用。
   - 全局 MCP 行为不变。

4. 已有关联 Skill 的智能体无需迁移数据，因为 `skillNames` 已存在于 `agent.json`。

## 不纳入本次实现的内容

1. 不修改 UI 展示样式。
2. 不新增 Skill 权限层级、分组或继承关系。
3. 不自动清理智能体中已删除 Skill 的 `skillNames` 字段。
4. 不改变 Skill 的执行方式：内容型 Skill 仍返回全文，`execute.tool` 型 Skill 仍走现有 `executeSkillToolConfig`。
