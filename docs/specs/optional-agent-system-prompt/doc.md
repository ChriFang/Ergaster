# 智能体系统提示词可选方案

## 背景与目标

当前编辑或创建智能体时，必须填写“系统提示词”才能提交。用户希望系统提示词可以为空，只填写智能体名称、描述、头像颜色、关联 Skills/MCP 等信息也能保存。

目标：取消“系统提示词”必填限制，同时保证空系统提示词的智能体可以被创建、更新、重载和运行。

## 现状分析

### 前端编辑页必填校验

文件：`e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`

函数：`handleSave()`

当前逻辑：

```ts
const normalizedContent = content.trim();

if (!normalizedContent) {
  showValidationError('请输入系统提示词。');
  return;
}

await onSave({
  content: normalizedContent,
  // ...
});
```

影响：用户未填写系统提示词时，前端直接阻止提交。

### 主进程 create/update 必填校验

文件：`e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`

函数：`createAgent(request)`、`updateAgent(request)`

当前逻辑：

```ts
const content = request.content.trim();

if (!content) {
  return { ok: false, error: '智能体内容不能为空' };
}
```

影响：即使绕过前端，主进程也会拒绝空系统提示词。

### 重载空 AGENT.md 的兜底校验

文件：`e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`

函数：`loadAgentFromDirectory(directoryPath)`

当前逻辑：

```ts
const content = contentRaw.trim();
if (!content) {
  await appendMainLog('ERROR', `Agent profile content is empty: ${directoryPath}`);
  return null;
}
```

影响：即使创建/更新时允许空系统提示词，后续重载智能体目录时仍会把空 `AGENT.md` 视为无效智能体，导致列表中消失或无法继续编辑。

### 运行时系统提示词使用逻辑

文件：`e:\other-code\desktop-tools\src\main\agent-service.ts`

当前逻辑：

```ts
selectedAgentContent = agentProfilesService.getAgentContent(agentId);

const requestMessages = selectedAgentContent
  ? ([{ role: 'system', content: selectedAgentContent }, ...workingMessages])
  : workingMessages;
```

现有运行逻辑已天然支持空内容：当 `selectedAgentContent` 为空字符串或 `null` 时，不注入 system message，直接使用用户消息和历史消息运行。因此运行时不需要额外修改。

## 技术方案

### 1. 前端允许空系统提示词提交

修改文件：`e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`

修改点：`handleSave()`

删除系统提示词必填校验：

```ts
if (!normalizedContent) {
  showValidationError('请输入系统提示词。');
  return;
}
```

保留：

- 名称必填校验。
- 描述必填校验。
- `content.trim()` 归一化后提交。

说明：如果用户只输入空格或换行，保存为 `''`，不保留无意义空白。

### 2. 主进程允许 create/update 使用空 content

修改文件：`e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`

修改点：`createAgent(request)`、`updateAgent(request)`

删除 create/update 中的 content 非空校验：

```ts
if (!content) {
  return { ok: false, error: '智能体内容不能为空' };
}
```

保留：

- `id` 非空校验。
- `title` 非空校验。
- metadata 写入逻辑。
- `AGENT.md` 写入逻辑。

保存空系统提示词时，`AGENT.md` 仍写入换行：

```ts
await fs.writeFile(contentPath, `${content}\n`, 'utf8');
```

当 `content === ''` 时文件内容为单个换行，便于保持文件存在。

### 3. 重载时允许空 AGENT.md

修改文件：`e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`

修改点：`loadAgentFromDirectory(directoryPath)`

删除空内容直接返回 `null` 的逻辑：

```ts
if (!content) {
  await appendMainLog('ERROR', `Agent profile content is empty: ${directoryPath}`);
  return null;
}
```

保留读取和 trim：

```ts
const content = contentRaw.trim();
```

这样空 `AGENT.md` 会加载为 `content: ''` 的有效智能体。

### 4. 运行时无需修改

`agent-service.ts` 当前已按 truthy 判断是否注入 system prompt：

- `content` 有值：注入 system message。
- `content` 为空：不注入 system message。

该行为符合“无需填写系统提示词也可以提交”的预期。

## 受影响文件

### 必改文件

1. `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
   - 修改类型：前端表单校验调整。
   - 受影响函数：`handleSave()`。
   - 修改内容：删除系统提示词必填校验。

2. `e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`
   - 修改类型：主进程保存和加载校验调整。
   - 受影响函数：
     - `createAgent(request)`：删除 content 非空校验。
     - `updateAgent(request)`：删除 content 非空校验。
     - `loadAgentFromDirectory(directoryPath)`：允许空 content 的 `AGENT.md` 加载。

### 不需要修改的文件

1. `e:\other-code\desktop-tools\src\shared\agent-profile.ts`
   - `content` 类型仍为 `string`，空字符串符合类型定义。

2. `e:\other-code\desktop-tools\src\main\agent-service.ts`
   - 运行时已支持不注入空 system prompt。

## 数据流路径

### 创建/编辑保存

1. 用户在 `AgentEditor.tsx` 中不填写系统提示词。
2. `handleSave()` 校验名称和描述后继续提交。
3. `AgentsPanel.tsx` 调用 `window.desktopApp.createAgent/updateAgent`。
4. IPC handler 透传请求到 `agentProfilesService.createAgent/updateAgent`。
5. 主进程保存 metadata 和空内容 `AGENT.md`。
6. 返回保存成功。

### 重载加载

1. `scanAndLoadAgents()` 遍历智能体目录。
2. `loadAgentFromDirectory()` 读取 `agent.json` 和 `AGENT.md`。
3. 空 `AGENT.md` 被 trim 为 `''`。
4. 返回有效 `AgentProfileRecord`，列表中继续展示该智能体。

### 对话运行

1. 用户选择空系统提示词智能体运行。
2. `getAgentContent(agentId)` 返回 `''`。
3. `agent-service.ts` 不注入 system message。
4. 对话正常按普通用户消息、历史消息和该智能体关联的 tools 运行。

## 边界条件与异常处理

1. 系统提示词为空字符串：允许保存，运行时不注入 system prompt。
2. 系统提示词只包含空格/换行：trim 后保存为空字符串。
3. 本地存在空 `AGENT.md`：允许加载为有效智能体。
4. `AGENT.md` 文件缺失：仍按现有 catch 逻辑视为加载失败；本需求不改变文件结构。
5. 名称为空：仍不允许提交。
6. 描述为空：仍不允许提交，保持当前行为。

## 预期结果

1. 创建智能体时，不填写系统提示词也可以保存成功。
2. 编辑已有智能体时，清空系统提示词也可以保存成功。
3. 保存后重新加载应用或点击重载智能体，空系统提示词智能体仍正常展示。
4. 使用空系统提示词智能体对话时，不额外注入 system prompt，但关联 Skills/MCP 等能力仍按原逻辑生效。

## 验证方式

1. 执行类型检查：

```bash
npm run typecheck
```

2. 手动验证建议：
   - 新建智能体：填写名称和描述，系统提示词留空，保存应成功。
   - 编辑智能体：清空系统提示词，保存应成功。
   - 重载智能体列表后，该智能体仍应存在。
   - 使用该智能体发起对话应正常响应。
