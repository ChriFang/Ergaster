# 智能体头像颜色块迁移说明

## 需求概述

参考 `E:\other-code\agent-ui` 的智能体头像表达，将 `desktop-tools` 中智能体相关入口从图标/文字色彩按钮迁移为“具体颜色块 + 名称首字”的视觉模式。

本次需求包含三部分：

1. 智能体管理界面中，“头像颜色”设置项的每个可选颜色项使用真实颜色块展示，选中后颜色块变大。
2. 设置智能体头像颜色后，智能体管理列表中的每个智能体项图标使用“颜色块 + 名称首字”代替当前 `Bot` 图标。
3. 主界面左侧边栏的智能体列表增加同样的“颜色块 + 名称首字”头像。

## 当前实现分析

### 当前项目相关文件

- `e:\other-code\desktop-tools\src\shared\agent-profile.ts`
  - 已定义 `AgentAvatarColor = 'cyan' | 'blue' | 'violet' | 'emerald' | 'amber' | 'rose'`。
  - `AgentProfileListItem`、`AgentProfileDetail`、创建/更新请求均已包含 `avatarColor`。
  - 本次不需要改类型和持久化字段。

- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
  - `AVATAR_COLORS` 当前以 `{ value, label }` 维护颜色选项。
  - “头像颜色”当前渲染为包含 `Palette` 图标、中文标签、选中 `Check` 的按钮。
  - 需要改成具体颜色块按钮，并保留可访问标签。

- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`
  - 智能体管理列表当前使用：
    ```tsx
    <div className={`agent-settings-icon agent-settings-icon-${agent.avatarColor}`}>
      <Bot size={16} strokeWidth={2} aria-hidden="true" />
    </div>
    ```
  - 需要改成显示智能体名称首字。
  - 删除不再使用的 `Bot` import。

- `e:\other-code\desktop-tools\src\renderer\features\layout\SidebarPanel.tsx`
  - 主界面侧栏智能体列表当前只显示标题与 ID。
  - 需要为非默认智能体项增加头像。
  - 侧栏默认模式保持现有纯文本结构，避免引入没有颜色数据的默认头像。

- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 已有 `.agent-settings-icon` 和 `.agent-settings-icon-{color}`。
  - 已有 `.agent-color-grid`、`.agent-color-chip`、`.agent-color-chip-active`。
  - 需要新增/调整头像颜色 token、颜色块选择器、管理列表头像、侧栏头像布局。

### agent-ui 参考实现

- `E:\other-code\agent-ui\components\settings\agents-panel.tsx`
  - 颜色选择器使用紧凑色块按钮：
    ```tsx
    <button
      className="size-6 rounded-md ring-offset-2 ring-offset-background transition-all"
      style={{
        backgroundColor: c,
        boxShadow: draft.avatarColor === c ? "0 0 0 2px var(--primary)" : "none",
      }}
    />
    ```
  - 设置页智能体列表头像使用色块 + 首字：
    ```tsx
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-md font-heading text-sm font-semibold text-background"
      style={{ backgroundColor: agent.avatarColor }}
    >
      {initialOf(agent.name)}
    </span>
    ```

- `E:\other-code\agent-ui\components\sidebar.tsx`
  - 侧栏智能体头像尺寸更小，使用相同模式：
    ```tsx
    <span
      className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md font-heading text-sm font-semibold text-background"
      style={{ backgroundColor: agent.avatarColor }}
    >
      {initialOf(agent.name)}
    </span>
    ```

- `E:\other-code\agent-ui\lib\format.ts`
  - 名称首字逻辑：
    ```ts
    export function initialOf(name: string) {
      return name.trim().charAt(0).toUpperCase() || "?"
    }
    ```

## 技术方案

### 1. 保留现有颜色枚举，补齐 UI 色值映射

不改 `AgentAvatarColor` 类型和主进程存储逻辑。当前项目已有 6 个语义色，比 `agent-ui` 的 5 个 chart token 多一个，保留现有可选项以避免破坏已有智能体配置。

在渲染层新增小型函数或常量，将 `AgentAvatarColor` 映射为 CSS class：

```tsx
className={`agent-avatar agent-avatar-${agent.avatarColor}`}
```

对应 CSS 使用实色块背景，而不是当前低透明背景：

```css
.agent-avatar-cyan { background: #22d3ee; }
.agent-avatar-blue { background: #3b82f6; }
.agent-avatar-violet { background: #8b5cf6; }
.agent-avatar-emerald { background: #10b981; }
.agent-avatar-amber { background: #f59e0b; }
.agent-avatar-rose { background: #f43f5e; }
```

### 2. 名称首字生成逻辑

新增一个局部 helper，避免重复写 `trim().charAt(0)`：

```tsx
function getAgentInitial(title: string) {
  return title.trim().charAt(0).toUpperCase() || '?';
}
```

优先放在 `AgentsPanel.tsx` 和 `SidebarPanel.tsx` 各自文件内，保持改动局部；也可按实现需要抽到共享 helper，但本次不强制新增公共文件，避免过度抽象。

边界处理：

- 空名称或全空白时显示 `?`。
- 中文首字会原样显示；英文首字转大写。
- 不改变智能体标题、ID、描述等数据。

### 3. 头像颜色设置项迁移为颜色块

将 `AgentEditor.tsx` 的颜色按钮从“图标 + 标签 + Check”改为具体颜色块：

```tsx
<button
  key={colorItem.value}
  type="button"
  className={`agent-color-swatch agent-avatar-${colorItem.value}${selected ? ' agent-color-swatch-active' : ''}`}
  onClick={() => setAvatarColor(colorItem.value)}
  disabled={saving}
  aria-label={`选择${colorItem.label}头像颜色`}
  aria-pressed={selected}
/>
```

处理逻辑：

- 用真实背景色展示颜色。
- 移除 `Palette` 和 `Check` 图标依赖。
- 选中态通过尺寸变大、描边和轻微外发光表达。
- 禁用状态保持不可点击和透明度下降。

预期 CSS：

```css
.agent-color-grid {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 36px;
}

.agent-color-swatch {
  width: 24px;
  height: 24px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  cursor: pointer;
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, opacity 160ms ease;
}

.agent-color-swatch-active {
  transform: scale(1.22);
  border-color: rgba(248, 250, 252, 0.92);
  box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.45), 0 8px 20px rgba(0, 0, 0, 0.24);
}
```

### 4. 设置页智能体列表头像迁移

将 `AgentsPanel.tsx` 中 `Bot` 图标替换为名称首字：

```tsx
<span className={`agent-avatar agent-avatar-settings agent-avatar-${agent.avatarColor}`} aria-hidden="true">
  {getAgentInitial(agent.title)}
</span>
```

预期效果：

- 头像尺寸约 `36px`，对应 `agent-ui` 的 `size-9`。
- 圆角矩形，不使用圆形头像。
- 文本使用深色背景上的浅色或白色，确保对比度。
- 保持列表项原有布局、描述、模型/Skills/MCP 元信息和操作按钮不变。

### 5. 主界面左侧边栏智能体头像迁移

在 `SidebarPanel.tsx` 的非默认智能体项中增加头像：

```tsx
<span className={`agent-avatar agent-avatar-sidebar agent-avatar-${agent.avatarColor}`} aria-hidden="true">
  {getAgentInitial(agent.title)}
</span>
<span className="app-agent-item-copy">
  <span className="app-agent-item-title">{agent.title}</span>
  <span className="app-agent-item-meta">ID: {agent.id}</span>
</span>
```

配套样式：

```css
.app-agent-item-with-avatar {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.app-agent-item-copy {
  min-width: 0;
}

.agent-avatar-sidebar {
  width: 32px;
  height: 32px;
  margin-top: 2px;
  border-radius: 10px;
}
```

默认模式按钮不增加头像，避免与真实智能体头像混淆；其现有交互和 active 状态保持不变。

## 影响范围

### 修改文件

- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
  - 移除颜色选项中的 `Palette` / `Check` 图标渲染。
  - 改为色块按钮。
  - 增加 `aria-label`、`aria-pressed`。

- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`
  - 删除 `Bot` import。
  - 增加名称首字 helper。
  - 列表头像从图标改为色块 + 首字。

- `e:\other-code\desktop-tools\src\renderer\features\layout\SidebarPanel.tsx`
  - 增加名称首字 helper。
  - 非默认智能体项增加头像节点和文字容器。
  - 增加专用 className，避免影响历史列表和默认模式。

- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 新增通用 `.agent-avatar`、尺寸修饰类、颜色类。
  - 调整 `.agent-color-grid` 和色块选择器样式。
  - 调整侧栏智能体项布局。
  - 可保留旧 `.agent-settings-icon-*` 兼容样式或替换为新 `.agent-avatar-*`，以实际实现最小 diff 为准。

### 不修改文件

- `src/shared/agent-profile.ts`
- `src/main/agent-profiles-service.ts`
- preload/IPC 类型
- 智能体配置文件格式

原因：`avatarColor` 数据流已存在且满足需求。

## 数据流

1. 用户在 `AgentEditor` 中点击颜色块。
2. `avatarColor` state 更新为现有枚举值之一。
3. 保存时通过 `createAgent` / `updateAgent` payload 写入本地智能体配置。
4. `AgentsPanel.loadAgents()` 刷新设置页列表，并通过 `onAgentsChanged` 同步给主界面 `App` 状态。
5. `SidebarPanel` 接收更新后的 `agents`，根据 `agent.avatarColor` 渲染侧栏头像。

## 边界条件与异常处理

- 空智能体名称：头像首字显示 `?`。
- 未知颜色值：主进程已有 `normalizeAvatarColor()` 归一化；渲染层仍使用现有枚举 class，不额外扩展容错。
- 色块按钮禁用：保存中不可点击，透明度降低，避免重复变更。
- 侧栏布局：只给智能体项增加头像，不影响历史记录 tab、默认模式项、设置按钮。
- 可访问性：颜色块按钮保留 `aria-label` 和 `aria-pressed`，避免纯颜色导致不可感知。

## 验证方式

- 运行 `npm run typecheck`，确认 TS import/helper/className 改动无类型错误。
- 运行 `npm run build`，确认 Vite renderer、main、preload 构建通过。
- 人工检查：
  - 智能体编辑器颜色项显示为具体颜色块，选中块变大。
  - 设置页智能体列表头像显示为颜色块 + 名称首字。
  - 主侧栏智能体列表头像显示为颜色块 + 名称首字。
  - 默认模式和历史记录列表不受影响。
