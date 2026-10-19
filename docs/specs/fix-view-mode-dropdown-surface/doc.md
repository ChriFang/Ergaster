# 修复模式下拉列表展开后灰底视觉问题

## 需求场景与问题现象
用户反馈界面右上角模式切换下拉框在展开后呈现灰色列表面板，和当前深色主题风格不一致，视觉效果较差。截图中的选项文案为“聊天模式 / 辩论模式 / 深度调研”。

经定位，该控件由 `ViewModeSwitcher` 渲染，当前实现使用原生 `<select>` 与 `<option>`。收起状态的外观由 renderer CSS 控制，但展开后的选项面板属于系统 / Chromium / Electron 原生控件渲染层，导致灰底外观无法通过现有 CSS 可靠修复。

## 架构与技术方案
采用“原生 select 替换为自定义下拉菜单”的方案，而不是继续调整原生 select 样式。

原因：
1. 原生 `select` 的展开面板颜色不受当前 renderer CSS 完整控制。
2. 代码中主进程已通过 `nativeTheme.themeSource = 'dark'` 试图缓解 Windows 原生控件浅灰底问题，但从实际效果看仍不能满足视觉要求。
3. 自定义下拉可以完全控制面板背景、边框、悬浮态、选中态、禁用态和层级，不受系统原生控件限制。

计划实现：
1. 将 `ViewModeSwitcher` 从原生 `select` 改为按钮触发的自定义菜单。
2. 保留现有三种模式及其切换逻辑：`chat` / `debate` / `deep_research`。
3. 在菜单中提供当前选中态视觉高亮。
4. 点击按钮展开菜单，点击选项切换模式并关闭菜单。
5. 点击组件外部、失焦或按 `Escape` 关闭菜单。
6. `disabled` 状态下禁止展开。
7. 维持当前深色风格，与现有控制台 header 样式统一。

## 影响文件
- 修改 `e:\other-code\desktop-tools\src\renderer\features\layout\ViewModeSwitcher.tsx`
  - 类型：组件结构重写
  - 影响组件：`ViewModeSwitcher`
  - 影响点：从原生 `select` 改为自定义 button + menu
- 修改 `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 类型：新增/替换样式
  - 影响类名：`view-mode-switcher` 相关样式
  - 影响点：菜单面板、菜单项、展开态、选中态、禁用态、图标旋转或按钮态
- 可能修改 `e:\other-code\desktop-tools\src\renderer\features\layout\ChatConsoleView.tsx`
  - 仅在必要时微调 header 对齐或层级
- 可能修改 `e:\other-code\desktop-tools\src\renderer\features\workflows\WorkflowConsoleView.tsx`
  - 仅在必要时微调 header 对齐或层级

## 实现细节
当前问题代码位于 `src/renderer/features/layout/ViewModeSwitcher.tsx:15`：

```tsx
<select
  className="view-mode-select"
  value={value}
  onChange={(event) => onChange(event.target.value as ViewMode)}
  disabled={disabled}
  aria-label="workflow 模式"
>
  {OPTIONS.map((option) => (
    <option key={option.value} value={option.value}>{option.label}</option>
  ))}
</select>
```

计划改为类似结构：

```tsx
<div className="view-mode-dropdown">
  <button type="button" className="view-mode-trigger" ...>
    <span>{currentLabel}</span>
  </button>
  {open ? (
    <div className="view-mode-menu" role="listbox">
      <button type="button" className="view-mode-option view-mode-option-active">聊天模式</button>
      ...
    </div>
  ) : null}
</div>
```

样式上将明确控制：
- 按钮背景、边框、hover、focus ring
- 菜单面板背景改为深色，与 header / surface card 保持一致
- 菜单项 hover 不再出现原生浅灰
- 当前选中项使用更明显的描边或高亮背景
- 菜单弹层 `z-index` 高于 header 内容，避免被遮挡

## 边界条件与异常处理
- `disabled=true` 时，不允许展开菜单，也不响应选项点击。
- 当前模式为 `chat` 时，应正确显示“聊天模式”；为 workflow 子模式时，应正确显示对应标签。
- 切换模式后应立即关闭菜单，避免状态残留。
- 点击组件外部应关闭菜单，避免悬浮面板遗留。
- 使用键盘 `Escape` 应关闭菜单；如果实现键盘导航成本较低，可支持 `Enter/Space` 打开，但不额外扩展复杂导航逻辑。
- 不改动 `ConsolePanel` 中既有的模式切换业务逻辑。

## 数据流路径
1. `ConsolePanel` 根据 `mode` 与 `selectedWorkflowType` 计算 `viewMode`。
2. `ChatConsoleView` / `WorkflowConsoleView` 将 `viewMode` 和 `onViewModeChange` 传给 `ViewModeSwitcher`。
3. `ViewModeSwitcher` 仅负责展示和触发选择。
4. 用户选择后仍调用现有 `onChange(nextMode)`，由 `ConsolePanel` 执行模式切换。

因此本次主要是展示组件替换，不改业务状态流。

## 预期结果
- 模式切换下拉展开后不再出现灰色原生列表面板。
- 展开菜单与整体深色主题一致。
- 菜单项 hover、选中态、禁用态清晰可控。
- 不影响聊天模式、辩论模式、深度调研模式的既有切换行为。

## 已确认的定位结论
- 组件位置：`e:\other-code\desktop-tools\src\renderer\features\layout\ViewModeSwitcher.tsx:15`
- 收起态样式：`e:\other-code\desktop-tools\src\renderer\styles.css:336`
- 使用位置：`e:\other-code\desktop-tools\src\renderer\features\layout\ChatConsoleView.tsx:108` 与 `e:\other-code\desktop-tools\src\renderer\features\workflows\WorkflowConsoleView.tsx:160`
- 原生控件背景问题佐证：`e:\other-code\desktop-tools\src\main\index.ts:22`
