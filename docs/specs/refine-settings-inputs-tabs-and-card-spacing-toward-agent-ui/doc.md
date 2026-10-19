# 设置输入框、Tab 与卡片间距继续对齐 agent-ui

## 需求场景与处理逻辑
本轮需求是在已完成设置界面整体迁移、标题收口、开关与字体迁移、背景与按钮风格统一之后，继续处理更细的节奏问题，使设置弹窗在微观层面更接近 `agent-ui`。本次明确聚焦三类细节：
- 输入框、文本域等表单控件的高度、内边距、圆角和字号继续收口；
- 左侧设置 tab 的字重、内边距与激活态继续收口；
- 各设置卡片、列表项、表单区块和操作区的间距节奏继续收口。

结合 `desktop-tools` 当前状态与 `agent-ui` 参考实现，现阶段差异主要体现在：
- `desktop-tools` 的输入控件 padding 和圆角仍略大，单行输入框没有统一到更紧凑的 32px 高度节奏；
- 左侧 tab 当前 active 态仍比 `agent-ui` 更重，文本权重与留白也略偏厚；
- 各卡片和列表项的 `padding / gap / margin` 仍比 `agent-ui` 稍大，导致设置页视觉密度偏松。

本轮处理原则：
- 优先只改 `src/renderer/styles.css`，尽量不动 JSX 结构；
- 保持当前功能、交互、数据流和组件层级不变，只微调视觉节奏；
- 继续采用“映射 `agent-ui` 风格而非复制 Tailwind 体系”的方式，在现有 CSS token 和 rgba 体系中实现近似效果；
- 只作用于设置弹窗范围，不影响聊天主界面和侧边栏主视图。

## 架构与技术方案
实现分为三部分：

1. 表单控件节奏收口
   - 调整 `.field input`、`.field textarea`、`.form-group input`、`.form-group textarea`、`.form-group select`、`.skill-textarea`、`.agent-textarea`、`.mcp-editor-textarea`；
   - 统一单行控件接近 `agent-ui` 的紧凑尺寸，目标是更稳定的 `32px` 高度观感；
   - 调整 `padding`、`border-radius`、`font-size` 和局部 `textarea` 最小高度，使表单更紧凑。

2. 左侧 tab 节奏收口
   - 调整 `.settings-dialog-nav`、`.settings-dialog-nav-list`、`.settings-dialog-nav-item`、`.settings-dialog-nav-item-active`；
   - 收紧导航内边距和列表项间距；
   - 降低 tab 文案厚重感，使其更接近 `agent-ui` 的 `text-sm + rounded-md + 轻量 active 底色` 模式；
   - active 态保留当前项目的主色语义，但减弱边框和阴影感。

3. 卡片与区块间距收口
   - 调整 `skills-panel`、`agents-panel`、`settings-panel`、`skill-editor`、`agent-editor`、`mcp-editor`、`mcp-default-binding-card`、`about-panel-card`；
   - 收口 `settings-form`、`settings-grid-two-columns`、`field`、`skills-content`、`skills-list`、`skill-item`、`agent-list-settings`、`editor-actions`、`settings-actions`、`skills-header-actions` 等区域间距；
   - 目标是形成接近 `agent-ui` 的统一节奏：页面块间距约 `16px`，section 内边距约 `16px`，列表项内边距约 `12px`，action 间距约 `8px`。

## 影响文件
- 修改 `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 微调设置弹窗中的 tab、表单控件、卡片与列表项间距。
- 如确实发现少量 JSX 需要辅助 class 才能精确控制节奏，则可能最小修改以下文件，但默认尽量不动：
  - `e:\other-code\desktop-tools\src\renderer\features\layout\SettingsDialogShell.tsx`
  - `e:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx`
  - `e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx`
  - `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`
  - `e:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`
  - `e:\other-code\desktop-tools\src\renderer\App.tsx`

## 实现细节
### 1. 输入框与文本域
参考 `agent-ui/components/ui/input.tsx`、`textarea.tsx`、`select.tsx`，建议方向：
```css
.field input,
.field textarea,
.form-group input,
.form-group textarea,
.form-group select,
.skill-textarea,
.agent-textarea,
.mcp-editor-textarea {
  border-radius: 10px;
  font-size: 14px;
}

.field input,
.form-group input,
.form-group select {
  min-height: 32px;
  padding: 4px 10px;
}

.field textarea,
.skill-textarea,
.agent-textarea,
.mcp-editor-textarea {
  padding: 8px 10px;
}
```
说明：
- 不要求强制所有 text input 写死 `height: 32px`，但观感要落到同一节奏；
- `textarea` 保持可读性，同时避免当前过于松散的内边距；
- API Key 叠层按钮的定位和右侧留白需同步检查，避免控件高度收紧后视觉错位。

### 2. 左侧 tab
参考 `agent-ui/components/settings-dialog.tsx`，建议方向：
```css
.settings-dialog-nav {
  padding: 12px;
}

.settings-dialog-nav-list {
  gap: 4px;
}

.settings-dialog-nav-item {
  padding: 8px 12px;
  gap: 10px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
}

.settings-dialog-nav-item-active {
  background: rgba(34, 211, 238, 0.1);
  border-color: transparent;
  box-shadow: none;
}
```
说明：
- 这里的重点不是完全复制 `agent-ui`，而是减弱当前 tab 的厚重感；
- 标题“设置”与导航项之间的间距也应同步收口，避免上重下松。

### 3. 卡片与区块间距
建议将当前若干较大的 `padding / gap / margin` 收敛到更统一的值：
```css
.skills-panel,
.agents-panel,
.settings-panel,
.skill-editor,
.agent-editor,
.mcp-editor,
.mcp-default-binding-card,
.about-panel-card {
  padding: 16px;
  gap: 12px;
}

.skill-item,
.agent-mcp-added-item {
  padding: 12px;
  gap: 12px;
}

.settings-form,
.settings-grid-two-columns {
  gap: 16px;
}

.field {
  gap: 6px;
}

.editor-actions,
.settings-actions,
.skills-header-actions {
  gap: 8px;
}
```
说明：
- 以 CSS 收口为主，不改组件树；
- `agent-ui` 的 section 常见模式是 `p-4 + space-y-3`，列表项是 `p-3 + gap-3`，可以直接映射到当前样式体系。

## 边界条件与异常处理
- 只收口设置弹窗内部节奏，不影响聊天窗口、消息列表和侧边栏主导航；
- 收紧输入控件后，带图标的密码框和文本域仍需保证点击区域与内容不拥挤；
- 卡片间距收紧后，about 页居中和底部版权布局不能被破坏；
- Skills、Agents、MCP 列表项的操作按钮行仍需保持一行内可读，不因间距压缩造成拥挤；
- 响应式断点下的小屏布局仍应可用，不能让移动/窄宽度状态下出现明显换行错乱。

## 数据流路径
- 本轮不涉及 renderer 以外的数据流改动；
- 所有微调均限于设置弹窗 renderer 样式层；
- 默认不调整 IPC、shared、main、preload 或持久化逻辑。

## 预期结果
- 输入框、文本域、按钮和标签之间的节奏更接近 `agent-ui`，设置页观感更紧凑；
- 左侧 tab 的字重、内边距与 active 态更轻、更稳定；
- 各设置卡片、列表项与操作区的留白更统一，整体视觉密度更接近 `agent-ui`。
