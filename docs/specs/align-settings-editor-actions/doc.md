# 设置界面编辑操作按钮右对齐

## 需求场景

用户希望设置弹窗内多个表单/编辑器的操作按钮统一靠右展示，并调整通用设置保存后的交互：

1. 通用设置：
   - 将“保存配置”按钮放到设置界面右侧。
   - 点击“保存配置”并成功保存后退出设置页面。
   - 去掉“配置已保存。”文本显示。
2. 智能体编辑器：
   - 将“保存智能体”和“取消”按钮放到右侧。
3. Skill 编辑器：
   - 将“保存 Skill”和“取消”按钮放到右侧。
4. MCP 编辑器：
   - 将“保存服务”和“取消”按钮放到右侧。
   - 去掉顶部 “MCP Editor” 文本。

## 当前代码分析

### 通用设置保存流程

- `e:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx`
  - `SettingsPanel` 接收 `saveStatus` 并在表单底部渲染：
    ```tsx
    {saveStatus ? <p className="save-status">{saveStatus}</p> : null}
    ```
  - “保存配置”按钮位于：
    ```tsx
    <div className="settings-actions settings-actions-column">
      <button className="primary-button" type="submit">
        保存配置
      </button>
    </div>
    ```

- `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - 通用设置渲染处直接传入 `onSubmit={handleSaveConfig}`。
  - 设置弹窗关闭函数为 `closeSettingsDialog`。

- `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-settings-state.ts`
  - `handleSaveConfig` 当前行为：
    ```ts
    async function handleSaveConfig(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setSaveStatus('正在保存配置...');
      await saveConfigWithValues(formValues);
      setSaveStatus('配置已保存。');
    }
    ```
  - 成功后设置 `配置已保存。`，这正是需要去掉的文本来源。

### 编辑器按钮布局

- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
  - 底部按钮容器为 `.editor-actions`，包含“保存智能体”和“取消”。

- `e:\other-code\desktop-tools\src\renderer\features\skills\SkillEditor.tsx`
  - 底部按钮容器为 `.editor-actions`，包含“保存 Skill”和“取消”。

- `e:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`
  - MCP 编辑器底部按钮容器为 `.editor-actions`，包含“保存服务”和“取消”。
  - MCP 编辑器顶部英文标题位于：
    ```tsx
    <p className="eyebrow">MCP Editor</p>
    ```

### 样式位置

- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - `.editor-actions` 当前只设置了上间距和上 padding。
  - `.settings-actions-column` 当前存在 `justify-content: space-between` 和 `align-items: center`，无法保证按钮靠右。

## 技术方案

### 1. 通用设置保存后关闭设置弹窗

在 `App.tsx` 中为通用设置创建包装提交函数，复用现有 `handleSaveConfig`，保存成功后调用 `closeSettingsDialog()`：

```tsx
onSubmit={(event) => {
  void handleSaveConfig(event).then(() => {
    closeSettingsDialog();
  });
}}
```

该方案保留 `handleSaveConfig` 的 `event.preventDefault()` 和保存逻辑，不改动底层配置保存 API。

### 2. 去掉“配置已保存。”显示

在 `use-settings-state.ts` 中将成功保存后的状态清空，而不是设置为“配置已保存。”：

```ts
await saveConfigWithValues(formValues);
setSaveStatus('');
```

由于保存成功后会关闭设置弹窗，成功状态文本无需展示。失败场景当前没有专门 catch，本次不额外扩展错误处理，避免超出需求范围。

同时在 `SettingsPanel.tsx` 中移除 `saveStatus` prop 和底部保存状态渲染，确保“配置已保存。”不会在通用设置界面显示。

### 3. 操作按钮靠右

在 `styles.css` 中统一调整：

```css
.editor-actions,
.settings-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
```

并将 `.settings-actions-column` 调整为右对齐，避免原有 `space-between` / `center` 影响按钮位置。

该改动会影响：
- 智能体编辑器 `.editor-actions`
- Skill 编辑器 `.editor-actions`
- MCP 编辑器 `.editor-actions`
- 通用设置 `.settings-actions`

这与需求一致。

### 4. 删除 MCP 编辑器顶部英文标题

在 `McpServersPanel.tsx` 中删除：

```tsx
<p className="eyebrow">MCP Editor</p>
```

保留中文标题：

```tsx
<h3>{editing.originalName ? '编辑 MCP 服务' : '新增 MCP 服务'}</h3>
```

## 受影响文件

1. `e:\other-code\desktop-tools\src\renderer\App.tsx`
   - 修改通用设置 `SettingsPanel` 的 `onSubmit` 传参。
   - 保存成功后关闭设置弹窗。

2. `e:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx`
   - 移除 `saveStatus` prop。
   - 删除底部 `saveStatus` 文本渲染。
   - 保留“保存配置”按钮。

3. `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-settings-state.ts`
   - 成功保存配置后不再设置“配置已保存。”。

4. `e:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`
   - 删除 MCP 编辑器顶部 “MCP Editor” 文本。

5. `e:\other-code\desktop-tools\src\renderer\styles.css`
   - 统一设置 `.editor-actions` 与 `.settings-actions` 为右对齐 flex 布局。
   - 调整 `.settings-actions-column` 对齐规则。

## 边界条件与异常处理

- 通用设置保存成功后关闭弹窗；若保存 Promise rejected，则 `.then()` 不执行，不会关闭弹窗。
- 不改变配置保存 payload、字段绑定和 API key 掩码逻辑。
- 不改变智能体、Skill、MCP 编辑器保存/取消行为，只调整按钮布局。
- 删除 “MCP Editor” 仅影响 MCP 服务编辑器，不影响默认模式 MCP 的 “Default Binding” 文本。
- 去掉 “配置已保存。” 不影响思考模式开关的保存状态文本，因为本次只处理通用设置表单保存后的成功文案。

## 数据流

### 通用设置保存

用户点击“保存配置” → `SettingsPanel` form submit → `App.tsx` 包装 `onSubmit` → `handleSaveConfig(event)` → `saveConfigWithValues(formValues)` → 保存成功后清空 `saveStatus` → `closeSettingsDialog()` 关闭设置弹窗。

### 编辑器按钮布局

Agent/Skill/MCP 编辑器 JSX 不需要移动按钮 DOM，统一由 `.editor-actions` 控制按钮靠右。

## 预期结果

- 通用设置底部“保存配置”按钮显示在右侧。
- 点击“保存配置”保存成功后设置弹窗关闭。
- 通用设置不再显示“配置已保存。”。
- 智能体编辑器底部“保存智能体”和“取消”显示在右侧。
- Skill 编辑器底部“保存 Skill”和“取消”显示在右侧。
- MCP 编辑器底部“保存服务”和“取消”显示在右侧。
- MCP 编辑器顶部不再显示 “MCP Editor”。
- TypeScript 类型检查通过。
