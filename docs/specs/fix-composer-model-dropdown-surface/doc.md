# 修复模型选择列表展开后灰底视觉问题

## 需求场景与问题现象
用户希望“模型选择列表也做相同修改”，即将输入区中的模型选择列表从原生下拉改为与模式切换一致的自定义深色下拉，避免展开后出现系统原生灰色列表面板，破坏整体深色主题视觉一致性。

经定位，模型选择列表位于 `Composer` 组件中，当前实现使用原生 `<select>` 与 `<option>`。这和刚修复的 `ViewModeSwitcher` 属于相同问题类型：收起态可以用 CSS 定制，但展开后的面板仍受系统 / Chromium / Electron 原生控件渲染影响。

## 架构与技术方案
采用与 `ViewModeSwitcher` 相同的总体方向：将原生 `select` 替换为自定义按钮 + 菜单结构，但针对模型选择保留其现有业务语义。

计划原则：
1. 保持模型数据来源、刷新逻辑、选择逻辑不变。
2. 保持刷新按钮 `composer-model-refresh` 与 loading 旋转效果不变。
3. 保持 `isRunning`、无模型、加载中等状态下的禁用语义。
4. 将视觉层从原生 `select` 换为自定义深色下拉，以消除展开灰底问题。

## 影响文件
- 修改 `e:\other-code\desktop-tools\src\renderer\features\composer\Composer.tsx`
  - 类型：组件结构重写
  - 影响组件：`Composer`
  - 影响点：将 `composer-model-select` 原生下拉替换为自定义菜单
- 修改 `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 类型：样式替换/新增
  - 影响类名：`composer-model-select-group` 相关视觉样式
  - 影响点：trigger、menu、option、禁用态、选中态、层级与布局
- 可能新增一个本地小型复用结构于 `Composer.tsx`
  - 仅当实现时需要内部辅助函数，不单独拆新文件

## 实现细节
当前问题代码位于 `src/renderer/features/composer/Composer.tsx:55`：

```tsx
<select
  className="composer-model-select"
  value={selectValue}
  onChange={(event) => onModelChange(event.target.value)}
  disabled={isRunning || !hasModels}
  title={modelsError ?? (hasModels ? '选择模型' : '未获取到模型，请在设置中检查 API Key 与 Base URL')}
>
  {!hasModels ? (
    <option value="">{modelsLoading ? '获取模型中…' : '未获取到模型'}</option>
  ) : (
    availableModels.map((model) => (
      <option key={model} value={model}>{model}</option>
    ))
  )}
</select>
```

计划改为：
1. 使用按钮触发的自定义菜单显示当前模型。
2. 仅当存在可选模型且未禁用时允许展开。
3. 菜单项来自 `availableModels.map(...)`。
4. 点击模型项后调用现有 `onModelChange(model)`，然后关闭菜单。
5. 无模型时不展开，trigger 显示“获取模型中…”或“未获取到模型”。
6. 保留 `title` 语义，用于承载 `modelsError` 或无模型说明。

建议结构示意：

```tsx
<div className="composer-model-select-group">
  <div className="composer-model-dropdown">
    <button type="button" className="composer-model-trigger">...</button>
    {open ? <div className="composer-model-menu">...</div> : null}
  </div>
  <button type="button" className="composer-model-refresh">...</button>
</div>
```

## 边界条件与异常处理
- `isRunning` 时：不可展开，不可切换模型。
- 无模型时：不可展开，trigger 显示占位文案。
- `modelsLoading` 且无模型时：trigger 显示“获取模型中…”。
- `modelsError` 存在时：继续通过 `title` 暴露错误信息，不额外扩展新的错误 UI。
- 当前 `selectedModel` 不在 `availableModels` 中时：沿用现有逻辑，显示首个可用模型或空字符串的回退语义。
- 点击组件外部、按 `Escape` 时关闭菜单。
- 选择模型后立即关闭菜单，不改变 `useSettingsState.selectModel` 的保存与错误处理逻辑。

## 数据流路径
1. `useSettingsState.refreshModels()` 负责获取模型列表。
2. `App` 将 `availableModels`、`selectedModel`、`modelsLoading`、`modelsError`、`selectModel`、`refreshModels` 传给 `ConsolePanel`。
3. `ConsolePanel` 透传到 `ChatConsoleView` / `WorkflowConsoleView`。
4. `Composer` 负责展示当前模型下拉和刷新按钮。
5. 用户选择模型后，仍调用现有 `onModelChange(model)`，最终走 `useSettingsState.selectModel()`。

因此本次只替换展示层和交互外壳，不改模型获取、保存和配置业务逻辑。

## 预期结果
- 模型下拉展开后不再出现灰色原生列表面板。
- 模型选择视觉与模式切换下拉保持一致的深色风格。
- 刷新按钮、加载状态、禁用语义和模型切换逻辑保持不变。
- 输入区在聊天视图和 workflow 视图中的模型选择表现一致。

## 已确认的定位结论
- 模型选择组件：`e:\other-code\desktop-tools\src\renderer\features\composer\Composer.tsx:55`
- 当前原生样式：`e:\other-code\desktop-tools\src\renderer\styles.css:1198`
- 数据来源与状态：`e:\other-code\desktop-tools\src\renderer\lib\hooks\use-settings-state.ts:98`
- 已有可参考的自定义下拉实现：`e:\other-code\desktop-tools\src\renderer\features\layout\ViewModeSwitcher.tsx:18`
