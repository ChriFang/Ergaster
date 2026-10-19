# 删除智能体编辑界面辅助说明文本

## 需求场景

用户要求在设置界面的智能体编辑界面中删除以下三段辅助说明文本：

1. `Skills 关联本轮仅完成界面与持久化，暂未接入运行时执行逻辑。`
2. `点击按钮即可快速选择或取消选择。`
3. `已禁用的服务仍可保留关联，列表中会显示状态。`

这些文案位于智能体编辑界面头部、关联 Skills 区域和关联 MCP 服务区域。用户仅要求去掉文本，不要求改变智能体编辑、保存、Skills/MCP 关联逻辑。

## 当前实现分析

文件：`e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`

### 编辑器头部说明

当前代码：

```tsx
<div className="editor-header">
  <div>
    <h3>{isCreating ? '创建智能体' : '编辑智能体'}</h3>
    <p className="settings-description">Skills 关联本轮仅完成界面与持久化，暂未接入运行时执行逻辑。</p>
  </div>
</div>
```

需要删除 `p.settings-description`，保留 `h3`。

### 关联 Skills 区域说明

当前代码：

```tsx
<div className="agent-relation-header">
  <div>
    <h4>关联 Skills</h4>
    <p className="settings-description">点击按钮即可快速选择或取消选择。</p>
  </div>
  <span className="agent-relation-count">{skillNames.length} 个已关联</span>
</div>
```

需要删除 `p.settings-description`，保留 `h4`、关联数量和按钮列表。

### 关联 MCP 服务区域说明

当前代码：

```tsx
<div className="agent-relation-header">
  <div>
    <h4>关联 MCP 服务</h4>
    <p className="settings-description">已禁用的服务仍可保留关联，列表中会显示状态。</p>
  </div>
  <span className="agent-relation-count">{enabledServerNames.length} 个已关联</span>
</div>
```

需要删除 `p.settings-description`，保留 `h4`、关联数量和按钮列表。

## 技术方案

采用最小 JSX 删除：

1. 删除编辑器头部中的说明段落。
2. 删除关联 Skills 标题下的说明段落。
3. 删除关联 MCP 服务标题下的说明段落。
4. 不删除 `.settings-description` CSS，因为其他页面仍使用该类。
5. 不改 `toggleSkill`、`toggleMcp`、`handleSave`、校验和保存逻辑。

## 影响文件

### `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`

修改类型：删除冗余说明文案 JSX。

受影响函数：

- `AgentEditor`

预计删除：

```tsx
<p className="settings-description">Skills 关联本轮仅完成界面与持久化，暂未接入运行时执行逻辑。</p>
<p className="settings-description">点击按钮即可快速选择或取消选择。</p>
<p className="settings-description">已禁用的服务仍可保留关联，列表中会显示状态。</p>
```

## 边界条件和异常处理

- 不改变智能体创建/编辑标题。
- 不改变表单字段。
- 不改变错误提示显示。
- 不改变 Skills/MCP 选择按钮和数量统计。
- 不改变已禁用 MCP 服务名称后追加 `（已关闭）` 的显示逻辑。
- 不改变保存 payload。
- 不修改 CSS，避免影响其他设置页面的说明文字。

## 数据流路径

本次没有数据流变更，仅移除静态文案渲染：

1. `AgentsPanel` 渲染 `AgentEditor`。
2. `AgentEditor` 渲染编辑表单和关联区域。
3. 三段说明文案不再渲染。
4. 用户仍可编辑字段、关联 Skills/MCP 服务并保存。

## 预期结果

- 智能体编辑界面不再显示指定三段说明文本。
- “创建智能体 / 编辑智能体”“关联 Skills”“关联 MCP 服务”标题仍显示。
- Skills/MCP 选择和保存功能不受影响。
- TypeScript 类型检查通过。
