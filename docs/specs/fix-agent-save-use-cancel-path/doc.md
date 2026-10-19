# 智能体保存复用取消返回路径与头像颜色保存修复说明

## 需求概述

用户反馈：

1. 在智能体编辑界面点击“保存智能体”按钮后还是无法返回智能体管理初始界面，可以参考“取消”按钮的执行逻辑，“取消”按钮能正确返回。
2. 选择的智能体头像色块还是没有保存，智能体列表的头像没有更新。

本次修复需要直接利用已验证可用的“取消”返回路径，并让头像颜色保存链路更直接、可验证。

## 当前问题分析

### 1. 保存成功后没有复用取消按钮返回路径

文件：`e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`

当前取消按钮：

```tsx
<button type="button" className="cancel-button" onClick={onCancel} disabled={saving}>
  <X size={14} strokeWidth={2} aria-hidden="true" />
  <span>取消</span>
</button>
```

`onCancel` 来自父组件 `AgentsPanel.handleCancelEdit()`：

```tsx
function handleCancelEdit() {
  setEditingAgent(null);
  setIsCreating(false);
}
```

用户确认取消按钮能正确返回，说明这个路径是可靠的。

当前保存按钮只执行 `handleSave()`，`handleSave()` 内部只调用 `await onSave(...)`，没有在保存成功后显式调用 `onCancel()`：

```tsx
try {
  await onSave({ ... });
} catch (...) {
  ...
} finally {
  setSaving(false);
}
```

虽然父组件保存成功路径中也有 `setEditingAgent(null)`，但用户实际反馈仍不返回。因此本次应在 `AgentEditor` 中保存成功后直接复用 `onCancel()`，与取消按钮走同一条可靠返回路径。

### 2. 头像颜色保存逻辑被 ref 复杂化但未解决问题

当前 `AgentEditor.tsx` 使用：

```tsx
const [avatarColor, setAvatarColor] = useState<AgentAvatarColor>(agent?.avatarColor ?? 'cyan');
const avatarColorRef = useRef<AgentAvatarColor>(agent?.avatarColor ?? 'cyan');
```

保存 payload 使用：

```tsx
avatarColor: avatarColorRef.current,
```

点击色块：

```tsx
function handleAvatarColorChange(nextAvatarColor: AgentAvatarColor) {
  avatarColorRef.current = nextAvatarColor;
  setAvatarColor(nextAvatarColor);
}
```

这套逻辑理论上能提交最新值，但用户仍反馈不生效。为了降低状态双写风险，本次改回单一状态源：`avatarColor` state。

保存 payload 直接使用当前 React state：

```tsx
avatarColor,
```

色块点击只更新 state：

```tsx
onClick={() => setAvatarColor(colorItem.value)}
```

原因：

- 颜色按钮和保存按钮是两个独立点击事件，React 会在事件间完成 state 更新。
- 单一状态源更容易验证 UI 选中态与保存值一致。
- 避免 state/ref 不一致导致实际提交值不可见。

### 3. 父组件保存链路继续负责持久化与列表更新

文件：`e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`

当前已新增：

- `toAgentListItem()`
- `sortAgentsByUpdatedAt()`
- `upsertAgentListItem()`
- 使用 `result.data` 更新本地 `agents`
- 调用 `onAgentsChanged?.(nextAgents)` 同步主侧栏

这条链路需要保留，并修复当前 diff 中部分中文乱码字符串，避免错误提示不可读。

保存成功后：

1. `AgentEditor.handleSave()` 提交 `avatarColor` state。
2. `AgentsPanel.handleSave()` 调用 create/update。
3. 主进程保存并返回 `AgentProfileDetail`。
4. `AgentsPanel` 用返回 detail 更新列表和侧栏。
5. `AgentEditor` 在 `await onSave()` 成功后调用 `onCancel()`，复用取消按钮返回路径。

## 技术方案

### 1. AgentEditor 保存成功后调用 onCancel

修改 `handleSave()`：

```tsx
try {
  await onSave({ ... });
  onCancel();
} catch (saveError) {
  setError(saveError instanceof Error ? saveError.message : '保存智能体失败');
} finally {
  setSaving(false);
}
```

行为：

- 保存失败：`onSave` throw，进入 catch，不调用 `onCancel()`，停留编辑器展示错误。
- 保存成功：调用 `onCancel()`，与取消按钮同路径返回管理列表。

### 2. AgentEditor 使用单一 avatarColor state 提交

修改：

- 移除 `useRef` import。
- 移除 `avatarColorRef`。
- `useEffect` 中只 `setAvatarColor(agent?.avatarColor ?? 'cyan')`。
- 删除 `handleAvatarColorChange()`。
- 色块点击改回 `setAvatarColor(colorItem.value)`。
- 保存 payload 使用 `avatarColor`。

关键代码：

```tsx
const [avatarColor, setAvatarColor] = useState<AgentAvatarColor>(agent?.avatarColor ?? 'cyan');
```

```tsx
avatarColor,
```

```tsx
onClick={() => setAvatarColor(colorItem.value)}
```

### 3. 保留父组件 result.data 同步列表逻辑

`AgentsPanel.tsx` 已经具备用保存返回 detail 更新列表和侧栏的逻辑，应保留。

同时修正当前文件中因编码显示异常导致的中文乱码字符串：

- 创建失败提示
- 更新失败提示
- 创建成功提示
- 更新成功提示
- 刷新失败提示

应恢复为：

```tsx
throw new Error(result?.error ?? (isCreating ? '创建智能体失败' : '更新智能体失败'));
showMessage('success', isCreating ? '智能体创建成功' : '智能体更新成功');
showMessage('error', '智能体已保存，但刷新列表失败');
```

### 4. 保留类型化保存结果

保留 `src/shared/agent-profile.ts` 中：

```ts
data?: AgentProfileDetail;
```

保留 `src/main/agent-profiles-service.ts` 中保存成功返回 detail 的修正：

```ts
return { ok: true, data: this.getAgentDetail(id) ?? undefined };
```

## 修改范围

### 修改文件

- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
  - 保存成功后调用 `onCancel()`。
  - 移除头像颜色 ref，改回单一 state 提交。
  - 色块点击直接更新 `avatarColor` state。

- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`
  - 保留保存返回 detail 同步列表逻辑。
  - 修正中文乱码提示字符串。

- `e:\other-code\desktop-tools\src\shared\agent-profile.ts`
  - 保留 `AgentProfileOperationResult.data?: AgentProfileDetail`。

- `e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`
  - 保留保存成功返回 detail 的类型修正。

### 不修改文件

- IPC handler
- preload 桥接
- 本地 agent.json 格式
- 头像颜色枚举

## 数据流

1. 用户点击头像色块。
2. `setAvatarColor(colorItem.value)` 更新 state，选中态和保存值来自同一状态源。
3. 用户点击“保存智能体”。
4. `AgentEditor.handleSave()` 将 `avatarColor` state 传给父组件。
5. `AgentsPanel.handleSave()` 调用 create/update，保存成功后用 `result.data` 更新列表与侧栏。
6. `AgentEditor.handleSave()` 的 `await onSave()` 成功返回后调用 `onCancel()`。
7. `onCancel()` 复用取消按钮路径，回到智能体管理初始界面。

## 边界条件

- 保存失败：不调用 `onCancel()`，留在编辑器并显示错误。
- 保存成功但后台刷新失败：仍已返回列表，提示刷新失败。
- 创建新智能体：保存结果插入列表，头像颜色来自所选 state。
- 编辑已有智能体：保存结果替换列表项，头像颜色立即更新。

## 验证方式

- 运行 `npm run typecheck`。
- 运行 `npm run build`。
- 人工验证：
  - 点击“取消”仍能返回。
  - 选择头像颜色后点击“保存智能体”，能像取消按钮一样返回智能体管理列表。
  - 设置页智能体列表头像颜色更新。
  - 主侧栏智能体头像颜色更新。
