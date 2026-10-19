# 删除 Skill 编辑界面顶部英文标题总结

## 完成内容

- 已删除 Skill 编辑界面顶部的 “Skill Editor” 英文标题。
- 已保留“创建 Skill / 编辑 Skill”主标题。
- 已保留说明文字、重置模板按钮、保存和取消逻辑。
- 已运行 TypeScript 类型检查并通过。

## 代码变更

### `src/renderer/features/skills/SkillEditor.tsx`

删除编辑器头部中的 eyebrow 文案：

```tsx
<p className="eyebrow">Skill Editor</p>
```

调整后头部保留：

```tsx
<h3>{isCreating ? '创建 Skill' : '编辑 Skill'}</h3>
<p className="settings-description">保留大文本框编辑正文，同时将名称、描述和启用状态结构化保存到 frontmatter。</p>
```

关键位置：

- `src/renderer/features/skills/SkillEditor.tsx:90`

## 验证结果

已确认：

- `SkillEditor.tsx` 中不再存在 “Skill Editor” 文案。
- Skill 编辑器主标题、说明文字和头部操作按钮保留。
- 未修改 Skill 表单保存、取消、模板重置和快捷键逻辑。

已运行：

```bash
npm run typecheck
```

结果：通过。
