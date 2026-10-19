# 修复模式下拉列表展开后灰底视觉问题总结

## 完成情况
已将模式切换控件从原生 `select` 替换为自定义深色下拉菜单，解决展开后灰色原生列表面板与整体主题不一致的问题。

## 问题原因
原实现使用原生 `<select>`。收起态虽然可通过 CSS 定制，但展开后的选项面板属于系统 / Chromium / Electron 原生控件渲染层，颜色无法通过当前 renderer 样式稳定控制，因此会出现灰底视觉问题。

## 实际改动
- 修改 `e:\other-code\desktop-tools\src\renderer\features\layout\ViewModeSwitcher.tsx`
  - 用按钮触发的自定义菜单替换原生 `select/option`
  - 保留 `chat`、`debate`、`deep_research` 三个选项和既有 `onChange` 调用
  - 新增菜单展开状态、外部点击关闭、`Escape` 关闭、禁用保护与选择后自动关闭
- 修改 `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 删除 `.view-mode-select` 相关原生 select 外观样式依赖
  - 新增 `view-mode-dropdown`、`view-mode-trigger`、`view-mode-menu`、`view-mode-option` 等深色样式
  - 补充 hover、focus-visible、选中态、禁用态与图标旋转样式

## 验证结果
- 已运行 `npm run typecheck`，结果通过
- 已确认 `ViewModeSwitcher` 中不再使用原生 `select` / `option`
- 已确认模式切换业务接口仍保持为 `onChange(nextMode)`，未改动 `ConsolePanel` 的业务逻辑

## 未改动项
- 未改动聊天模式、辩论模式、深度调研模式的具体业务流程
- 未改动 `ChatConsoleView` 与 `WorkflowConsoleView` 的模式切换接线方式
- 未移除主进程中 `nativeTheme.themeSource = 'dark'` 的现有配置
