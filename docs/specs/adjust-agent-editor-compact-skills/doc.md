# 调整 AgentEditor 顶部标题与 Skills 按钮密度

## 需求场景

用户希望对智能体编辑界面做两处 UI 调整：

1. 去掉智能体编辑界面顶部的“Agent Editor”标题。
2. 智能体编辑界面中的“关联 Skills”按钮当前显示偏大，当 Skills 数量较多时占用过多 UI 空间，需要缩小按钮显示，可以通过调小字体等方式实现。

## 当前实现分析

### Agent Editor 标题

文件：`e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`

当前顶部区域：

```tsx
<div className="editor-header">
  <div>
    <p className="eyebrow">Agent Editor</p>
    <h3>{isCreating ? '创建智能体' : '编辑智能体'}</h3>
    <p className="settings-description">Skills 关联本轮仅完成界面与持久化，暂未接入运行时执行逻辑。</p>
  </div>
</div>
```

需要删除的是 `p.eyebrow` 里的英文“Agent Editor”，保留中文主标题“创建智能体/编辑智能体”和说明文案。

### Skills 按钮

文件：`e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`

当前 Skills 和 MCP 服务都使用同一个按钮类名：

```tsx
className={`agent-selection-chip${selected ? ' agent-selection-chip-active' : ''}`}
```

文件：`e:\other-code\desktop-tools\src\renderer\styles.css`

当前 `.agent-selection-chip` 与 `.settings-toggle-button` 共用样式：

```css
.agent-selection-chip,
.settings-toggle-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  border-radius: 12px;
  border: 1px solid rgba(120, 139, 164, 0.16);
  background: rgba(30, 41, 59, 0.26);
  color: var(--text-soft);
  cursor: pointer;
  padding: 8px 12px;
}
```

按钮列表容器：

```css
.agent-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
```

## 技术方案

采用最小变更：

1. 删除 `AgentEditor.tsx` 顶部的 `<p className="eyebrow">Agent Editor</p>`。
2. 将智能体关联按钮调得更紧凑：
   - 减小 `.agent-selection-chip` 的 `gap`。
   - 减小 `min-height`。
   - 减小 `padding`。
   - 增加较小的 `font-size`。
3. 为避免影响 `.settings-toggle-button`，将 `.agent-selection-chip` 与 `.settings-toggle-button` 的尺寸样式拆开或单独覆盖 `.agent-selection-chip`。
4. 缩小 `.agent-chip-list` 的 `gap`，提高多 Skills 场景的信息密度。
5. 图标尺寸如仍显大，可将 Skills/MCP 按钮内的图标从 `14` 调整为 `12`。

## 影响文件

### `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`

修改类型：删除顶部英文标签；可选缩小 chip 图标。

涉及位置：

- 顶部 header 中的 `p.eyebrow`。
- Skills 按钮内 `Sparkles`、`Check`、`Plus` 图标尺寸。
- MCP 按钮内 `Check`、`Plus` 图标尺寸。

建议改动：

```tsx
<div className="editor-header">
  <div>
    <h3>{isCreating ? '创建智能体' : '编辑智能体'}</h3>
    <p className="settings-description">Skills 关联本轮仅完成界面与持久化，暂未接入运行时执行逻辑。</p>
  </div>
</div>
```

如果样式缩小后图标仍占空间，同步改为：

```tsx
<Sparkles size={12} strokeWidth={2} aria-hidden="true" />
{selected ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : <Plus size={12} strokeWidth={2} aria-hidden="true" />}
```

### `e:\other-code\desktop-tools\src\renderer\styles.css`

修改类型：压缩 agent chip 尺寸。

涉及选择器：

- `.agent-selection-chip`
- `.agent-chip-list`
- `.settings-toggle-button`（只需确认不被误伤）

建议样式方向：

```css
.agent-selection-chip {
  gap: 5px;
  min-height: 28px;
  padding: 4px 8px;
  border-radius: 10px;
  font-size: 12px;
}

.agent-chip-list {
  gap: 6px;
}
```

如果保留与 `.settings-toggle-button` 的共用基础样式，可以在后面添加 `.agent-selection-chip` 覆盖，避免影响其它设置按钮。

## 边界条件

- 只去掉英文“Agent Editor”，不去掉“创建智能体/编辑智能体”。
- Skills 多时按钮更紧凑，但仍保持可点击、可辨识和选中态。
- 不改变 Skills 的选择逻辑。
- 不改变 MCP 的关联逻辑。
- 不改变保存逻辑和校验逻辑。
- 不提交当前工作区中已有的无关改动：`.comate/specs/fix-agent-save-remove-redundant-reload/tasks.md`。

## 数据流路径

本次没有数据流变更，仅调整渲染结构和样式：

1. `AgentEditor` 根据 `availableSkills` 渲染 Skills chip。
2. `.agent-selection-chip` 控制 chip 视觉尺寸。
3. 用户点击 chip 仍调用 `toggleSkill` 或 `toggleMcp`。
4. 选中态仍通过 `agent-selection-chip-active` 表示。

## 预期结果

- 智能体编辑界面顶部不再显示“Agent Editor”。
- “创建智能体/编辑智能体”中文标题仍保留。
- 关联 Skills 的按钮显示更紧凑，Skills 较多时减少 UI 占用。
- TypeScript 类型检查通过。
