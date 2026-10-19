# 默认模式头像与智能体头像保存修复说明

## 需求概述

本次修复两个问题：

1. 主界面左侧边栏“默认模式”智能体没有头像图标，需要增加一个默认浅蓝色头像。
2. 智能体编辑界面选择头像色块后，点击保存不生效；需要修复保存逻辑，并确保点击保存成功后返回智能体管理列表界面。

## 当前实现分析

### 默认模式头像缺失

文件：`e:\other-code\desktop-tools\src\renderer\features\layout\SidebarPanel.tsx`

当前默认模式按钮结构：

```tsx
<button
  type="button"
  className={`app-agent-item${selectedAgentId === null ? ' app-agent-item-active' : ''}`}
  onClick={() => onSelectAgent(null)}
>
  <span className="app-agent-item-title">默认模式</span>
  <span className="app-agent-item-meta">使用全局默认配置执行请求</span>
</button>
```

而普通智能体项已经使用：

```tsx
<span className={`agent-avatar agent-avatar-sidebar agent-avatar-${agent.avatarColor}`} aria-hidden="true">
  {getAgentInitial(agent.title)}
</span>
<span className="app-agent-item-copy">...</span>
```

因此默认模式只需要复用带头像布局，并使用专用浅蓝色默认头像 class，避免伪造 `AgentAvatarColor` 数据。

### 头像色块保存不生效

文件：`e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`

当前头像颜色 state 与保存 payload：

```tsx
const [avatarColor, setAvatarColor] = useState<AgentAvatarColor>(agent?.avatarColor ?? 'cyan');

<button
  className={`agent-color-swatch agent-avatar-${colorItem.value}${selected ? ' agent-color-swatch-active' : ''}`}
  onClick={() => setAvatarColor(colorItem.value)}
/>

await onSave({
  ...,
  avatarColor,
});
```

父组件保存逻辑文件：`e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`

```tsx
const result = await window.desktopApp.updateAgent({
  id: payload.id,
  ...,
  avatarColor: payload.avatarColor,
});

setEditingAgent(null);
setIsCreating(false);
await Promise.all([loadAgents(), loadMcpServers(), loadSkills()]);
```

从当前代码看，保存成功后理论上已经返回列表。用户反馈“不生效”更可能是点击色块后提交读到旧 state，或色块按钮在某些交互下只触发视觉选中但保存时未稳定使用最新选择。

为避免 React state 异步更新边界导致保存拿到旧值，本次修复将增加一个 ref 同步保存最新头像颜色：

```tsx
const avatarColorRef = useRef<AgentAvatarColor>(agent?.avatarColor ?? 'cyan');

function handleAvatarColorChange(nextAvatarColor: AgentAvatarColor) {
  avatarColorRef.current = nextAvatarColor;
  setAvatarColor(nextAvatarColor);
}
```

在 `useEffect` 初始化和保存 payload 中同步使用：

```tsx
const nextAvatarColor = agent?.avatarColor ?? 'cyan';
avatarColorRef.current = nextAvatarColor;
setAvatarColor(nextAvatarColor);
```

```tsx
avatarColor: avatarColorRef.current,
```

这样即使用户点选颜色后马上点击保存，也会提交最后一次点击的颜色。

## 技术方案

### 1. 默认模式增加浅蓝色头像

修改 `SidebarPanel.tsx` 默认模式按钮：

```tsx
<button
  type="button"
  className={`app-agent-item app-agent-item-with-avatar${selectedAgentId === null ? ' app-agent-item-active' : ''}`}
  onClick={() => onSelectAgent(null)}
>
  <span className="agent-avatar agent-avatar-sidebar agent-avatar-default" aria-hidden="true">
    默
  </span>
  <span className="app-agent-item-copy">
    <span className="app-agent-item-title">默认模式</span>
    <span className="app-agent-item-meta">使用全局默认配置执行请求</span>
  </span>
</button>
```

样式新增：

```css
.agent-avatar-default {
  background: #7dd3fc;
}
```

处理逻辑：

- 默认模式头像固定显示“默”。
- 使用浅蓝色，和当前项目 cyan/sky 色调一致。
- 不改变 `selectedAgentId === null` 的业务含义。
- 不影响普通智能体头像颜色。

### 2. 修复头像色块保存取值

修改 `AgentEditor.tsx`：

- 从 React 引入 `useRef`。
- 新增 `avatarColorRef`，与 `avatarColor` state 保持同步。
- 新增 `handleAvatarColorChange()`，点击色块时同时更新 ref 和 state。
- `useEffect` 中切换编辑对象时同步重置 ref。
- `handleSave()` 中使用 `avatarColorRef.current` 提交。

关键代码：

```tsx
const [avatarColor, setAvatarColor] = useState<AgentAvatarColor>(agent?.avatarColor ?? 'cyan');
const avatarColorRef = useRef<AgentAvatarColor>(agent?.avatarColor ?? 'cyan');
```

```tsx
function handleAvatarColorChange(nextAvatarColor: AgentAvatarColor) {
  avatarColorRef.current = nextAvatarColor;
  setAvatarColor(nextAvatarColor);
}
```

```tsx
avatarColor: avatarColorRef.current,
```

### 3. 保存成功后返回智能体管理界面

`AgentsPanel.tsx` 当前保存成功后已经执行：

```tsx
setEditingAgent(null);
setIsCreating(false);
await Promise.all([loadAgents(), loadMcpServers(), loadSkills()]);
```

本次会保留该逻辑，并在实现时确认不会因异常路径提前阻断。如果保存失败，仍留在编辑器并展示错误；如果保存成功，返回列表。

如需进一步明确顺序，可保持先关闭编辑器再刷新列表，保证用户点击保存后立即回到智能体管理列表：

```tsx
setEditingAgent(null);
setIsCreating(false);
await Promise.all([loadAgents(), loadMcpServers(), loadSkills()]);
```

## 影响范围

### 修改文件

- `e:\other-code\desktop-tools\src\renderer\features\layout\SidebarPanel.tsx`
  - 默认模式项增加头像节点。
  - 默认模式项使用 `app-agent-item-with-avatar` 和 `app-agent-item-copy`。

- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
  - 引入 `useRef`。
  - 增加头像颜色 ref 和同步更新函数。
  - 保存 payload 使用 ref 中最新头像颜色。

- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 增加 `.agent-avatar-default` 浅蓝色样式。

### 不修改文件

- `src/shared/agent-profile.ts`
- 主进程智能体配置读写逻辑
- preload/IPC 定义

原因：本次问题属于渲染层交互和默认模式展示补齐，不需要改数据结构。

## 数据流

1. 用户在 `AgentEditor` 点击头像颜色色块。
2. `handleAvatarColorChange()` 同时更新 `avatarColorRef.current` 和 `avatarColor` state。
3. 用户点击保存。
4. `handleSave()` 将 `avatarColorRef.current` 传给 `AgentsPanel.handleSave()`。
5. `AgentsPanel.handleSave()` 调用 `createAgent` 或 `updateAgent`。
6. 保存成功后 `setEditingAgent(null)`，界面返回智能体管理列表。
7. `loadAgents()` 重新加载列表并通过 `onAgentsChanged` 同步主侧栏。

## 边界条件与异常处理

- 用户点击颜色后立即保存：提交 ref 中最新颜色。
- 保存失败：保留在编辑界面并展示错误，不返回列表。
- 切换编辑对象：`useEffect` 同步重置 state 和 ref，避免串用上一个智能体的颜色。
- 默认模式：只增加展示头像，不参与智能体配置保存。

## 验证方式

- 运行 `npm run typecheck`。
- 运行 `npm run build`。
- 人工检查：
  - 主界面默认模式显示浅蓝色“默”头像。
  - 编辑已有智能体，切换头像颜色后保存，返回智能体管理列表。
  - 设置页列表和主侧栏对应智能体头像颜色更新。
  - 创建新智能体时选择头像颜色后保存，返回列表且颜色正确。
