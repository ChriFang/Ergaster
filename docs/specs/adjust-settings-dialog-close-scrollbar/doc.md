# 调整设置弹窗关闭按钮与右侧滚动条

## 需求场景

用户反馈设置界面存在两个视觉问题：

1. “X”关闭按钮位置需要往最右上角移动。
2. 右侧滚动条长度应该缩短，不应覆盖到顶部和底部。

附图显示关闭按钮当前离右上边缘有一定内缩，右侧滚动条轨道/滑块视觉上贴近弹窗顶部和底部边界。

## 当前实现分析

### 设置弹窗结构

文件：`e:\other-code\desktop-tools\src\renderer\features\layout\SettingsDialogShell.tsx`

当前结构：

```tsx
<div className="settings-dialog-shell" onClick={(event) => event.stopPropagation()}>
  <button className="settings-dialog-close-button" type="button" onClick={onClose} aria-label="关闭设置">
    <X size={16} strokeWidth={2.2} />
  </button>

  <nav className="settings-dialog-nav" aria-label="设置导航">...</nav>

  <section className="settings-dialog-content">
    <div className="settings-dialog-content-scroll">{renderContent(activeTab)}</div>
  </section>
</div>
```

### 当前关闭按钮样式

文件：`e:\other-code\desktop-tools\src\renderer\styles.css`

```css
.settings-dialog-close-button {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(120, 139, 164, 0.18);
  border-radius: 10px;
  background: rgba(10, 15, 23, 0.9);
  color: var(--text-soft);
  cursor: pointer;
}
```

按钮当前 `top/right` 都是 `10px`，需要更靠近右上角。

### 当前滚动容器样式

```css
.settings-dialog-content-scroll {
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  padding: 24px;
}
```

滚动条属于 `.settings-dialog-content-scroll`。由于该元素高度是 `100%`，滚动条轨道从内容区域顶部延伸到底部。虽然内容有 `padding`，但浏览器原生滚动条仍跟随滚动容器边界显示，因此看起来覆盖到顶部和底部。

## 技术方案

采用纯 CSS 最小调整，不改组件结构和业务逻辑：

1. 将 `.settings-dialog-close-button` 保持在弹窗右上角外侧区域：
   - `top` 使用负值，例如 `-10px`。
   - `right` 使用负值，例如 `-10px`。
   - 关闭按钮保持 `z-index`，继续可点击。
   - `.settings-dialog-shell` 保持 `overflow: visible`，避免外移按钮被裁剪。
2. 为了仍然保持弹窗圆角裁剪效果，将实际可滚动/导航内容的溢出控制在内部区域，不依赖 shell 裁剪关闭按钮。
3. 用户反馈关闭按钮覆盖问题已经解决，但右侧管理内容变少，顶部和底部出现大量留白。原因是上一轮为了避开右上角，把 `.settings-dialog-content` 设为 `padding: 48px 0 16px`，同时把 `.settings-dialog-content-scroll` 设为 `height: calc(100% - 64px)`，两者叠加压缩了可用内容高度。
4. 本次调整应保留关闭按钮外置方案，但减少内容区域上下留白：
   - 将 `.settings-dialog-content` 改为较小上下留白，例如 `padding: 12px 0`。
   - 将 `.settings-dialog-content-scroll` 改为 `height: calc(100% - 24px)`，仅为滚动条保留少量上下避让空间。
   - 将内部 `padding` 恢复为更接近原始密度的 `12px 24px`，减少顶部和底部空白。
5. 这样关闭按钮仍位于弹窗外侧，不再覆盖右侧滚动条；滚动条仍不会贴满顶部和底部，但右侧管理内容可用高度明显恢复。

## 影响文件

### `e:\other-code\desktop-tools\src\renderer\styles.css`

修改类型：设置弹窗布局样式调整。

涉及选择器：

- `.settings-dialog-close-button`
- `.settings-dialog-content`
- `.settings-dialog-content-scroll`
- 小屏媒体查询中的 `.settings-dialog-content-scroll`

建议改动：

```css
.settings-dialog-shell {
  overflow: visible;
}

.settings-dialog-close-button {
  top: -10px;
  right: -10px;
}

.settings-dialog-nav,
.settings-dialog-content {
  overflow: hidden;
}

.settings-dialog-content {
  padding: 48px 0 16px;
}

.settings-dialog-content-scroll {
  height: calc(100% - 64px);
  padding: 0 24px 8px;
}
```

小屏已有：

```css
@media (max-width: 720px) {
  .console-panel,
  .console-message-stack,
  .settings-dialog-content-scroll {
    padding: 14px;
  }
}
```

需要确认小屏下不会因覆盖 padding 导致顶部/底部滚动条再次贴边。可在媒体查询中补充：

```css
.settings-dialog-content-scroll {
  padding: 2px 14px;
}
```

但为避免小屏内容过挤，优先只调整基础布局，若验证显示不合适再补充媒体查询覆盖。

## 边界条件

- 不改变点击遮罩关闭设置弹窗的逻辑。
- 不改变 `onClose` 回调。
- 不改变设置导航、内容渲染和各设置页功能。
- 关闭按钮仍保持可点击区域 `34px * 34px`。
- 滚动条缩短后，内容仍能完整滚动到底部。
- 不提交当前工作区中已有的无关改动：`.comate/specs/fix-agent-save-remove-redundant-reload/tasks.md`。

## 数据流路径

本次没有数据流变更，仅调整 CSS 布局：

1. `SettingsDialogShell` 渲染 `.settings-dialog-shell`。
2. 关闭按钮继续绝对定位在弹窗内。
3. `.settings-dialog-content` 提供上下留白。
4. `.settings-dialog-content-scroll` 作为实际滚动容器，高度变短，滚动条随容器高度缩短。

## 预期结果

- 设置弹窗右上角的 “X” 更靠近右上角。
- 右侧滚动条不再从顶部延伸到底部，视觉上避开上下边界。
- 设置内容顶部和底部仍保持原有视觉留白。
- TypeScript 类型检查通过。
