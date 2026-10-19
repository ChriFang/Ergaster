# 智能体系统提示词可选实现总结

## 完成内容

已将智能体编辑/创建时的“系统提示词”从必填改为可选。用户现在可以在系统提示词为空的情况下保存智能体。

## 修改文件

1. `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
2. `e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`
3. `e:\other-code\desktop-tools\src\main\agent-service.ts`

## 具体变更

### 前端提交校验

在 `AgentEditor.tsx` 的 `handleSave()` 中删除了系统提示词非空校验：

- 删除“请输入系统提示词。”的校验阻断。
- 保留智能体名称必填。
- 保留智能体描述必填。
- 继续使用 `content.trim()` 提交，因此纯空格或纯换行会保存为空字符串。

### 主进程保存校验

在 `agent-profiles-service.ts` 中删除了 create/update 对 `content` 的非空校验：

- 创建智能体时允许 `content === ''`。
- 更新智能体时允许 `content === ''`。
- `AGENT.md` 文件仍会正常写入，空系统提示词保存为换行文件内容。

### 主进程加载校验

在 `loadAgentFromDirectory(directoryPath)` 中删除了空 `AGENT.md` 返回 `null` 的逻辑：

- 空 `AGENT.md` 现在会加载为 `content: ''` 的有效智能体。
- 避免重载后空系统提示词智能体从列表中消失。

### 运行时日志修正

在 `agent-service.ts` 中调整了智能体运行时读取内容的逻辑：

- 原逻辑会把空系统提示词误判为“未找到或为空”，记录 ERROR 日志。
- 新逻辑先通过 `getAgentDetail(agentId)` 判断智能体是否存在。
- 智能体存在但 `content` 为空时，不记录错误，只是不注入 system message。
- 智能体不存在时才记录 `Selected agent profile not found`。

## 行为结果

1. 新建智能体时，系统提示词留空可以提交成功。
2. 编辑已有智能体时，清空系统提示词可以提交成功。
3. 重载智能体列表后，空系统提示词智能体仍可正常加载和展示。
4. 使用空系统提示词智能体对话时，不注入 system message，但其关联 Skills/MCP 仍按现有逻辑生效。

## 验证结果

已执行：

```bash
npm run typecheck
```

结果：通过，无 TypeScript 类型错误。
