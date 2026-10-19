# 设置界面右侧板块色调向 agent-ui 对齐

## 需求场景与处理逻辑

用户希望继续参考 `E:\other-code\agent-ui` 做设置界面迁移，本次聚焦“设置界面右侧板块色调”与 `agent-ui` 对齐。

当前 `desktop-tools` 设置弹窗右侧已完成部分背景和按钮迁移，但右侧内容区和内部卡片仍存在较重的渐变、较实的深色背景和局部重复定义。`agent-ui` 的对应风格更偏向：深蓝黑底色、低透明 muted/card 层、克制边框/ring、少阴影、青色仅用于 active/focus/强调状态。

处理逻辑：

1. 保持现有 React 组件结构不变，优先只调整 CSS。
2. 将右侧内容背景从明显青色径向光和多段渐变收敛为更平的深蓝黑基底。
3. 将右侧主卡片、管理面板、关于卡片统一到低透明 muted/card 色调。
4. 将列表项、编辑器辅助区、checkbox 行、chip 等子板块从较实深色收敛为 muted 低透明层。
5. 为可交互列表项和 chip 补充克制 hover 色调，避免依赖重阴影。
6. 表单输入焦点态参考 `agent-ui` 的 ring 表达，保留现有尺寸节奏。

## 架构与技术方案

### agent-ui 参考风格

只读调研结果显示，`agent-ui` 主要使用以下层级：

- 全局基底：`--background` 近似深蓝黑。
- 卡片层：`--card` / `--muted`，通常是 `bg-muted/20`、`bg-muted/30`、`bg-muted/40`。
- 边界：`border-border`、`ring-foreground/10`，阴影较克制。
- 交互：active 使用 `bg-primary/10` + primary 文本；focus 使用 `ring-ring/50`。

参考文件：

- `E:\other-code\agent-ui\app\globals.css`
- `E:\other-code\agent-ui\components\settings-dialog.tsx`
- `E:\other-code\agent-ui\components\settings\general-panel.tsx`
- `E:\other-code\agent-ui\components\settings\agents-panel.tsx`
- `E:\other-code\agent-ui\components\settings\skills-panel.tsx`
- `E:\other-code\agent-ui\components\settings\mcp-panel.tsx`
- `E:\other-code\agent-ui\components\ui\input.tsx`
- `E:\other-code\agent-ui\components\ui\textarea.tsx`

### desktop-tools 改造策略

本次只修改 renderer 样式文件：

- `E:\other-code\desktop-tools\src\renderer\styles.css`

不改动以下逻辑：

- 设置 tab 切换逻辑。
- Agents / Skills / MCP 数据读写逻辑。
- About 页面 JSX 结构。
- 表单保存/取消行为。

核心策略：以 `.settings-dialog-content`、`.settings-surface-card`、`.skills-panel`、`.agents-panel`、`.skill-item`、`.agent-mcp-added-item`、`.settings-checkbox-row`、`.agent-color-chip`、`.agent-selection-chip`、`.settings-toggle-button`、`.about-panel-card` 为样式锚点，统一调低透明度和阴影层级。

## 受影响文件

### 修改文件

`E:\other-code\desktop-tools\src\renderer\styles.css`

预计修改点：

- `.settings-dialog-content`
  - 类型：样式更新。
  - 影响：设置弹窗右侧整体背景色调。
  - 调整：弱化青色径向光和多段渐变，改为更接近 `agent-ui` 的平缓深蓝黑背景，可保留极轻微顶部冷色氛围。

- `.settings-panel-embedded, .skills-panel, .about-panel-card`
  - 类型：样式更新。
  - 影响：右侧主要内容卡片的默认背景。
  - 调整：从 `rgba(15, 23, 42, 0.72)` 收敛到更低透明 muted 层。

- `.settings-surface-card`
  - 类型：样式更新。
  - 影响：通用设置卡片基类。
  - 调整：减少实色渐变感，使用低透明 muted/card 背景、轻边框和轻 inset/ring。

- `.skills-panel, .agents-panel`
  - 类型：样式更新。
  - 影响：Skills、Agents、MCP 管理根面板。
  - 调整：与 `.settings-surface-card` 保持一致，避免重复使用更重渐变。

- `.skill-item, .agent-mcp-added-item`
  - 类型：样式更新。
  - 影响：Skills/Agents/MCP 列表项和已添加 MCP 项。
  - 调整：背景从较重 `rgba(15, 23, 42, 0.42)` 调低到 `agent-ui` 的 `bg-muted/30` 类似层级，并新增轻 hover。

- `.field input`, `.field textarea`, `.form-group input`, `.form-group textarea`, `.form-group select`, `.skill-textarea`, `.agent-textarea`, `.mcp-editor-textarea`
  - 类型：样式更新。
  - 影响：右侧设置表单和编辑器输入控件。
  - 调整：输入背景从较实深色降低为透明/低透明 input 层，focus 增加 3px 青色 ring。

- `.agent-color-chip`, `.agent-selection-chip`, `.settings-toggle-button`
  - 类型：样式更新。
  - 影响：Agent 编辑器选择 chip 与 toggle。
  - 调整：降低默认背景浓度，补充 hover，保留 active 青色强调。

- `.settings-checkbox-row`
  - 类型：样式更新。
  - 影响：MCP 默认绑定等 checkbox 行。
  - 调整：降低默认背景浓度，补充 hover。

- `.editor-hint`, `.editor-hint pre`
  - 类型：样式更新。
  - 影响：编辑器提示和代码预览区域。
  - 调整：与 muted/card 层级一致，避免过重实色。

- `.about-panel-card`
  - 类型：样式更新。
  - 影响：关于页右侧卡片。
  - 调整：与设置主卡片统一低透明 muted/card 色调。

## 实现细节

### 右侧整体背景

将当前样式：

```css
.settings-dialog-content {
  background:
    radial-gradient(circle at top right, rgba(34, 211, 238, 0.08), transparent 22%),
    linear-gradient(180deg, rgba(8, 12, 18, 0.98) 0%, rgba(10, 15, 23, 0.98) 48%, rgba(9, 14, 24, 0.99) 100%);
}
```

收敛为更接近 `agent-ui` 的低干扰深色背景，例如：

```css
.settings-dialog-content {
  background:
    radial-gradient(circle at top right, rgba(34, 211, 238, 0.035), transparent 24%),
    linear-gradient(180deg, rgba(9, 14, 22, 0.99) 0%, rgba(10, 15, 23, 0.99) 100%);
}
```

### 主卡片和管理面板

将 `.settings-surface-card` 与 `.skills-panel, .agents-panel` 统一为 muted/card 低透明层，例如：

```css
.settings-surface-card {
  border-color: rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.28);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.025),
    0 0 0 1px rgba(255, 255, 255, 0.008);
}
```

`skills-panel`、`agents-panel` 保留尺寸、圆角、padding、min-height，仅将背景和阴影收敛到同一层级。

### 列表项与交互态

将 `.skill-item, .agent-mcp-added-item` 从偏实的深色背景降级：

```css
.skill-item,
.agent-mcp-added-item {
  background: rgba(30, 41, 59, 0.30);
  border-color: rgba(148, 163, 184, 0.14);
}

.skill-item:hover,
.agent-mcp-added-item:hover {
  background: rgba(30, 41, 59, 0.46);
  border-color: rgba(148, 163, 184, 0.20);
}
```

### 输入控件焦点态

参考 `agent-ui` 的 `ring-3 ring-ring/50`，在保留当前控件高度的前提下增加 ring：

```css
.field input:focus,
.field textarea:focus,
.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus,
.skill-textarea:focus,
.agent-textarea:focus,
.mcp-editor-textarea:focus {
  border-color: rgba(34, 211, 238, 0.68);
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.18);
}
```

## 边界条件与异常处理

- 不修改业务逻辑，因此不影响设置保存、删除、编辑、MCP 绑定等行为。
- 不修改组件结构，因此不会改变可访问性结构和事件绑定。
- CSS hover 仅作用于已有可交互/卡片元素，不引入新的状态管理。
- 输入 focus ring 需要避免过亮，防止与当前深色主题冲突。
- About 页面需要保持居中布局不变，只调整色调层级。
- MCP 管理复用 `.skills-panel` 和 `.skill-item`，本次调整会同步影响 MCP 列表项，这是预期行为。

## 数据流路径

本次无数据流改动。现有路径保持不变：

- `SettingsDialogShell` 负责左侧 tab 与右侧 `renderContent(activeTab)`。
- `SettingsPanel`、`SkillsPanel`、`AgentsPanel`、`McpServersPanel`、About section 输出既有 className。
- `styles.css` 根据这些 className 调整视觉层级。

## 预期结果

- 设置界面右侧背景更接近 `agent-ui` 的深蓝黑平面基底。
- 通用设置、Agents、Skills、MCP、About 的右侧主卡片色调一致。
- 列表项和编辑器区域从较重深色块收敛为低透明 muted 层。
- 可交互列表项、chip、checkbox 行具备更统一的轻 hover 反馈。
- 输入控件 focus 更接近 `agent-ui` 的 ring 表达。
- 不改变任何功能行为。

## 验证方式

- 运行 `npm run typecheck`，确认 TypeScript 无新增类型错误。
- 运行 `npm run build`，确认 renderer/main/preload 构建通过。
- 视觉检查设置弹窗右侧各 tab：通用设置、智能体管理、Skills 管理、MCP 管理、关于页面。