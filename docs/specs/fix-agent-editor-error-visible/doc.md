# 修复 AgentEditor 校验错误提示不可见

## 问题场景

在 `AgentEditor.tsx` 中点击“保存智能体”时，如果描述为空，代码会执行：

```tsx
if (!normalizedDescription) {
  setError('请输入智能体描述。');
  return;
}
```

断点已确认运行到 `setError('请输入智能体描述。')`，但 UI 上没有明显显示错误提示。

## 现有处理逻辑

`AgentEditor` 使用本地状态保存错误信息：

```tsx
const [error, setError] = useState('');
```

保存时按顺序校验：名称、描述、模型、系统提示词。描述为空时设置错误并返回。

错误提示当前渲染在编辑器顶部、标题区域下方：

```tsx
{error ? <div className="skills-message skills-message-error">{error}</div> : null}
```

## 初步根因分析

### 1. 样式不完整，错误提示视觉上不明显

`styles.css` 中当前只有 `.skills-message-error` 的边框色：

```css
.message-error .message-card-shell,
.activity-panel-error,
.skills-message-error {
  border-color: rgba(248, 113, 113, 0.38);
}
```

但未看到 `.skills-message` 的基础盒子样式，也没有给 `.skills-message-error` 单独设置文字色、背景色、padding、border 等完整提示样式。

因此 DOM 节点即使被插入，也可能只表现为普通文本，或者由于缺少边框/背景/间距而不明显。

### 2. 错误提示位置在顶部，点击保存按钮时可能不在当前视口

`AgentEditor` 内容位于 `SettingsDialogShell` 的滚动容器内：

```tsx
<div className="settings-dialog-content-scroll">{renderContent(activeTab)}</div>
```

滚动容器样式：

```css
.settings-dialog-content-scroll {
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  padding: 24px;
}
```

保存按钮在编辑器底部，错误提示在编辑器顶部。如果用户滚动到底部后点击保存，错误提示可能被插入到上方，但当前滚动位置不变，导致用户看不到。

## 技术方案

采用最小修复：

1. 给错误提示补齐可见样式，使 `.skills-message.skills-message-error` 明显可见。
2. 在校验失败后让错误提示进入可见区域，避免用户在底部点击保存后看不到顶部提示。
3. 不改变保存数据结构，不改变 IPC 调用，不改主进程 agent profile 持久化逻辑。

## 影响文件

### 修改文件

#### `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`

修改类型：增强错误提示可见性。

涉及函数：

- `AgentEditor`
- `handleSave`

建议改动：

- 引入 `useRef`。
- 为错误提示节点增加 ref。
- 增加统一的校验失败处理函数，例如：

```tsx
function showValidationError(message: string) {
  setError(message);
  requestAnimationFrame(() => {
    errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}
```

- 将校验分支中的 `setError(...)` 替换为 `showValidationError(...)`。
- 错误提示节点增加 `role="alert"`，提升可访问性：

```tsx
{error ? (
  <div ref={errorRef} className="skills-message skills-message-error" role="alert">
    {error}
  </div>
) : null}
```

#### `e:\other-code\desktop-tools\src\renderer\styles.css`

修改类型：补齐错误消息样式。

涉及选择器：

- `.skills-message`
- `.skills-message-error`

建议样式：

```css
.skills-message {
  padding: 10px 12px;
  border: 1px solid rgba(120, 139, 164, 0.18);
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
}

.skills-message-error {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(248, 113, 113, 0.38);
}
```

## 边界条件和异常处理

- 名称为空时仍优先显示“请输入智能体名称。”。
- 描述为空时显示“请输入智能体描述。”。
- 模型为空时显示“请输入模型名称。”。
- 系统提示词为空时显示“请输入系统提示词。”。
- 保存接口失败时仍使用现有 catch 分支显示接口错误。
- 不新增后端 description 必填校验，避免扩大修改范围。
- `requestAnimationFrame` 只在前端校验失败后执行，不影响保存成功路径。

## 数据流路径

1. 用户点击 `AgentEditor` 底部保存按钮。
2. `handleSave` 读取并 trim 表单字段。
3. 校验失败时调用统一错误展示函数。
4. `error` 状态更新触发 React 重新渲染。
5. 错误节点以 `.skills-message.skills-message-error` 渲染。
6. 浏览器滚动到错误提示附近。
7. 用户看到明确的错误提示。

## 预期结果

- 断点进入 `setError('请输入智能体描述。')` 对应路径后，UI 能明确显示“请输入智能体描述。”。
- 当用户在底部点击保存时，页面会自动把错误提示滚动到可见位置。
- 错误提示具有红色文字、红色半透明背景和边框，与项目现有暗色 UI 风格一致。
- 不影响已有智能体保存、取消、Skills/MCP 关联选择逻辑。
