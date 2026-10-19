# 删除 Skill 编辑界面顶部英文标题

## 需求场景

用户要求删除 Skill 编辑界面顶部的 “Skill Editor” 标题。

当前 Skill 编辑界面头部同时显示：

```tsx
<p className="eyebrow">Skill Editor</p>
<h3>{isCreating ? '创建 Skill' : '编辑 Skill'}</h3>
<p className="settings-description">保留大文本框编辑正文，同时将名称、描述和启用状态结构化保存到 frontmatter。</p>
```

其中 “Skill Editor” 是英文 eyebrow 文案，与界面中已有的中文主标题“创建 Skill / 编辑 Skill”重复。本次仅移除该英文辅助标题，保留中文主标题和说明文字。

## 当前实现分析

### Skill 编辑组件

文件：`e:\other-code\desktop-tools\src\renderer\features\skills\SkillEditor.tsx`

相关位置：

```tsx
<div className="editor-header">
  <div>
    <p className="eyebrow">Skill Editor</p>
    <h3>{isCreating ? '创建 Skill' : '编辑 Skill'}</h3>
    <p className="settings-description">保留大文本框编辑正文，同时将名称、描述和启用状态结构化保存到 frontmatter。</p>
  </div>
  <div className="editor-header-actions">
    ...
  </div>
</div>
```

`SkillEditor` 由 `SkillsPanel` 在编辑或创建 Skill 时渲染：

文件：`e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx`

```tsx
{editingSkill ? (
  <SkillEditor
    name={editingSkill.name}
    description={editingSkill.description}
    enabled={editingSkill.enabled}
    content={editingSkill.content}
    isCreating={isCreating}
    onSave={handleSaveSkill}
    onCancel={handleCancelEdit}
  />
) : (...)}
```

## 技术方案

采用最小 JSX 调整：

1. 删除 `SkillEditor.tsx` 中的：

```tsx
<p className="eyebrow">Skill Editor</p>
```

2. 保留以下内容不变：
   - `h3` 中文标题：创建 Skill / 编辑 Skill。
   - `.settings-description` 说明文字。
   - 右侧“重置模板”按钮。
   - 表单字段、保存、取消和快捷键逻辑。

不需要修改 CSS，因为 `.eyebrow` 可能仍被其他界面使用，例如 Agent 编辑界面以外的其他标题区域。

## 影响文件

### `e:\other-code\desktop-tools\src\renderer\features\skills\SkillEditor.tsx`

修改类型：删除冗余 JSX 文案。

受影响函数：

- `SkillEditor`

预计改动：

```diff
- <p className="eyebrow">Skill Editor</p>
  <h3>{isCreating ? '创建 Skill' : '编辑 Skill'}</h3>
```

## 边界条件和异常处理

- 不改变 Skill 创建/编辑判断逻辑。
- 不改变保存校验逻辑。
- 不改变 `onSave`、`onCancel`、模板重置、快捷键处理。
- 不删除 `.eyebrow` CSS，避免影响其他页面。
- 若页面布局依赖该元素高度，删除后只会减少头部冗余高度，符合用户减少顶部标题的目标。

## 数据流路径

本次没有数据流变更，仅调整渲染结构：

1. `SkillsPanel` 选择编辑或创建 Skill。
2. `SkillsPanel` 渲染 `SkillEditor`。
3. `SkillEditor` 头部不再渲染 “Skill Editor”。
4. 表单状态和保存流程保持不变。

## 预期结果

- Skill 编辑界面顶部不再显示 “Skill Editor”。
- 仍显示“创建 Skill”或“编辑 Skill”。
- Skill 表单功能不受影响。
- TypeScript 类型检查通过。
