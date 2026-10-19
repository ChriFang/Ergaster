# UI操作优化：菜单按钮改为弹窗显示

## 需求场景

优化桌面工具的 UI 操作体验，将菜单中的两个功能入口从内嵌面板模式改为弹窗（Modal）模式：

1. **Skills管理**：点击菜单按钮，打开 Skills 管理弹窗
2. **设置**：点击菜单按钮，打开设置弹窗

### 当前实现

- 点击 "Skills 管理" → 切换显示/隐藏 `SkillsPanel` 组件（占据聊天区域）
- 点击 "设置" → 切换显示/隐藏 `SettingsPanel` 组件（占据聊天区域）
- 关于弹窗已使用 Modal 模式

### 目标实现

- 点击 "Skills 管理" → 打开 Skills 管理 **Modal**
- 点击 "设置" → 打开设置 **Modal**
- Modal 覆盖层使用现有样式 `.modal-overlay`
- Modal 内容区域使用现有样式 `.modal-content`，但需要适配更大尺寸

## 技术方案

### 状态管理

新增两个状态变量：
```typescript
const [showSkillsModal, setShowSkillsModal] = useState(false);
const [showSettingsModal, setShowSettingsModal] = useState(false);
```

### 菜单按钮行为变更

**Skills 管理按钮**：
```tsx
onClick={() => {
  setShowSkillsModal(true);
  setIsMenuOpen(false);
}}
```
按钮文本固定为 "Skills 管理"（不再动态切换）

**设置按钮**：
```tsx
onClick={() => {
  setShowSettingsModal(true);
  setIsMenuOpen(false);
}}
```
按钮文本固定为 "设置"（不再动态切换）

### Modal 实现

使用与 "关于" Modal 相同的模式：

```tsx
{showSkillsModal && (
  <div className="modal-overlay" onClick={() => setShowSkillsModal(false)}>
    <div className="modal-content skills-modal" onClick={(e) => e.stopPropagation()}>
      <SkillsPanel onClose={() => setShowSkillsModal(false)} />
    </div>
  </div>
)}

{showSettingsModal && (
  <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
    <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
      <SettingsPanel onClose={() => setShowSettingsModal(false)} />
    </div>
  </div>
)}
```

### 移除面板显示逻辑

从 `chat-scroll-area` 中移除：
- `{showSkillsPanel ? <SkillsPanel ... /> : null}`
- `{showSettings ? <SettingsPanel ... /> : null}`

可以移除的状态：
- `showSkillsPanel`
- `showSettings`
- 相关导入

### 样式调整

新增 Modal 尺寸样式：

```css
/* Skills Modal */
.modal-content.skills-modal {
  width: 800px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  padding: 0;
}

/* Settings Modal */
.modal-content.settings-modal {
  width: 600px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  padding: 24px;
}
```

调整 SkillsPanel 样式以适配 Modal：
- 移除 `.skills-panel` 的 margin-bottom 和内边距
- Modal 容器提供内边距

## 受影响文件

| 文件 | 修改类型 |
|------|----------|
| `src/renderer/App.tsx` | 修改：状态管理、菜单按钮、Modal 渲染 |
| `src/renderer/styles.css` | 修改：新增 Modal 样式 |

## 边界条件

1. **多 Modal 叠加**：不同时打开两个 Modal（点击菜单后只能打开一个）
2. **ESC 关闭**：使用现有的 document keydown 监听（可选扩展）
3. **点击遮罩关闭**：点击 overlay 区域关闭 Modal
4. **面板状态清理**：打开 Modal 时不清理可能存在的面板状态（因为会被移除）

## 数据流

```
用户点击菜单 → 打开 Modal → 用户操作 → 关闭 Modal
                ↓
         showSkillsModal = true
         showSettingsModal = true
```

## 预期结果

1. 点击 "Skills 管理" 菜单项 → 弹窗居中显示 Skills 管理界面
2. 点击 "设置" 菜单项 → 弹窗居中显示设置界面
3. 点击弹窗外部遮罩或关闭按钮 → 弹窗关闭
4. 聊天区域始终保持可见，不被功能面板遮挡
