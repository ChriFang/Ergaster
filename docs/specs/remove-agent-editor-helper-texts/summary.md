# 删除智能体编辑界面辅助说明文本总结

## 完成内容

已从智能体编辑界面删除以下三段辅助说明文本：

- `Skills 关联本轮仅完成界面与持久化，暂未接入运行时执行逻辑。`
- `点击按钮即可快速选择或取消选择。`
- `已禁用的服务仍可保留关联，列表中会显示状态。`

保留内容：

- `创建智能体 / 编辑智能体` 标题。
- `关联 Skills` 标题和已关联数量。
- `关联 MCP 服务` 标题和已关联数量。
- Skills/MCP 选择按钮。
- 保存、取消、校验和 payload 逻辑。

## 代码变更

### `src/renderer/features/agents/AgentEditor.tsx`

删除编辑器头部说明：

```tsx
<p className="settings-description">Skills 关联本轮仅完成界面与持久化，暂未接入运行时执行逻辑。</p>
```

删除关联 Skills 区域说明：

```tsx
<p className="settings-description">点击按钮即可快速选择或取消选择。</p>
```

删除关联 MCP 服务区域说明：

```tsx
<p className="settings-description">已禁用的服务仍可保留关联，列表中会显示状态。</p>
```

关键位置：

- `src/renderer/features/agents/AgentEditor.tsx:128`
- `src/renderer/features/agents/AgentEditor.tsx:204`
- `src/renderer/features/agents/AgentEditor.tsx:235`

## 验证结果

已确认：

- `AgentEditor.tsx` 中不再存在三段目标文案。
- `toggleSkill`、`toggleMcp`、`handleSave` 未被修改。
- Skills/MCP 关联数量和按钮仍保留。

已运行：

```bash
npm run typecheck
```

结果：通过。
