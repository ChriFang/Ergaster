# 托盘图标与关闭行为 — 实施总结

## rev3 变更记录（关闭按钮行为样式改造）

按用户要求（2026-09-24）：

- **样式**：「关闭按钮行为」从 `<select>` 下拉改为横排分段按钮组（每次询问/最小化到托盘/直接退出），每项带边框、选中项青色描边，对齐思考强度 Low/High/Max 截图样式。新增 `styles.css` 的 `.settings-segmented`/`.settings-segmented-item`/`.settings-segmented-item-active`（settings 作用域，不复用 composer 竖排菜单类）。
- **位置**：设置项从 OneAPI 兼容组之后移至设置页最后（GitHub Token 之后、保存按钮之前）。
- **逻辑不变**：点击即调 `onCloseActionChange` 即时保存（乐观更新 + 失败回滚），`aria-pressed` 标记选中态。补充：按用户要求移除了按钮组下方的说明文案「点窗口关闭按钮（X）时的去向，选择立即保存。」。
- **验证**：`npm run typecheck` 通过；grep 确认设置项唯一且位于 GitHub Token 之后。纯 UI 改动，无测试变更。

## rev2 变更记录（托盘强制开启）

按用户要求（2026-09-24）托盘改为强制开启，不再提供配置：

- **移除**：`trayEnabled` 配置字段（`AppConfig`/`defaultConfig`/`sanitizeConfig`）、设置页「托盘图标」开关、`handleTrayEnabledChange` 及其导出与 App 接线、`config:save` 的托盘同步逻辑、启动时按配置判断。
- **调整**：`resolveCloseBehavior` 签名改为 `(closeAction, platform)`，去掉托盘关闭分支；「关闭按钮行为」下拉始终渲染，文案简化为「点窗口关闭按钮（X）时的去向，选择立即保存。」；`tray-service.ts` 不变（`destroyTray` 保留导出）。
- **兼容性**：rev1 期间落盘的 `config.json` 中遗留的 `trayEnabled` 字段会被 `sanitizeConfig` 重建对象时自然丢弃，无需迁移；新增测试「丢弃 rev1 遗留的 trayEnabled 字段」固化该行为。
- **验证**：`npm run typecheck` 通过；`npm test` 356 pass / 0 fail（6 个新配置测试替代原 5 个）。

## rev1 完成概览

5 个任务全部完成。`npm run typecheck` 通过；`npm test` 355 个测试全部通过（含新增 5 个托盘配置测试）。

## 各任务执行结果

### Task 1: 共享配置与关闭行为决策
- `src/shared/config.ts`：新增 `WindowCloseAction`/`CloseBehavior` 类型；`AppConfig` 增加 `trayEnabled`（默认 true）与 `closeAction`（默认 'ask'）；`sanitizeConfig` 完成校验；新增 `resolveCloseBehavior(config, platform)` 纯函数。
- 新建 `src/shared/config.test.ts`（5 个测试：合法值保留、非法值回退、缺省默认、win32 决策矩阵、非 win32 → native），已登记进 package.json `test` 脚本两处列表。

### Task 2: 主进程托盘服务
- 新建 `src/main/tray/tray-service.ts`：`initTrayService` 注入窗口句柄（沿用 ui-window-manager 注入模式）；`createTray`（幂等 + win32 校验 + 复用 `assets/icon.ico` + 菜单「打开主窗口/退出」+ 左键 click 唤起）；`destroyTray`；`showMainWindow`（缺失重建 / restore / show / focus）。

### Task 3: 主进程生命周期接线
- `src/main/index.ts`：模块顶层单实例锁（未获锁 `app.quit()`；持锁 `second-instance` → `showMainWindow`）；`whenReady` 首行守卫；`isQuitting` 在 `before-quit` 置位；win32 `close` 拦截（同步 `preventDefault` 后异步决策）+ `handleWindowCloseRequest`（ask 三按钮弹窗、选择落盘、退出分支先 await saveConfig 再 quit；minimize 直接 hide；exit 置位后 quit）；`whenReady` 按配置初始化托盘；`config:save` 对比前后 `trayEnabled` 同步创建/销毁托盘。

### Task 4: Renderer 设置页
- `src/renderer/config-form.ts`、`src/renderer/features/settings/settings-model.ts`：表单初始值与规范化增加两字段。
- `src/renderer/lib/hooks/use-settings-state.ts`：payload 增加 `trayEnabled`/`closeAction`；新增 `handleTrayEnabledChange`/`handleCloseActionChange`（乐观更新 + 失败回滚）；`openSettingsDialog` 打开 general tab 时重拉配置，修复主进程落盘后表单陈旧。
- `src/renderer/features/settings/SettingsPanel.tsx`：「托盘图标」checkbox + 「关闭按钮行为」下拉（每次询问/最小化到托盘/直接退出），下拉仅托盘开启时渲染，均即时保存。
- `src/renderer/App.tsx`：general 分支 props 接线。

### Task 5: 验证
- `npm run typecheck` 通过（两份 tsconfig）。
- `npm test`：355 pass / 0 fail。
- 手动验收清单（需用户在真实 GUI 环境执行）见下文。

## 与 doc.md 的实现偏差（均已记录理由）

1. **`sanitizeCloseAction` helper**：`WINDOW_CLOSE_ACTIONS.includes(input?.x)` 无法让 TS 收窄 `input` 非空（TS18049），改为独立 helper 函数，与现有 `sanitizeStringArray` 等模式一致。
2. **去掉 `tray.on('destroyed')`**：Electron Tray 没有 destroyed 事件（doc 草案笔误）；`destroyTray()` 内显式清空引用，这是唯一销毁路径。
3. **`saveConfigWithValues` payload 增加两字段**：即时保存 handler 复用该函数构建 payload，若不加字段则托盘配置永远不会随 `config:save` 提交；同时使「保存配置」按钮也能持久化当前表单中的托盘设置。

## 缺陷修复记录

- **设置页托盘设置重复渲染**：向 `SettingsPanel.tsx` 插入托盘 UI 块时，锚点 `<div className="settings-grid-two-columns">` 在文件中出现两处（允许路径/搜索目录 与 工具轮数/超时 两个网格），导致同一块被插入两次。已删除第二处重复块（原 169-194 行），仅保留 OneAPI 兼容组之后的一处；typecheck 复验通过。

## 手动验收清单（用户执行）

1. 启动应用 → 托盘区出现图标；左键点击唤起主窗口；右键菜单「打开主窗口/退出」可用。
2. 首次点 X → 弹出三按钮对话框；「取消」/Esc → 窗口保留；「最小化到托盘」→ 窗口隐藏、正在执行的任务继续流式推进；「退出」→ 程序退出。
3. 落盘验证：`%APPDATA%\Desktop Agent\config.json` 中 `closeAction` 变为所选值；再次点 X 不再询问。
4. 设置 → 通用设置：托盘开关与关闭行为下拉即时保存生效；关闭托盘后点 X 直接退出。
5. 应用运行中再次双击桌面图标 → 唤起已有窗口，不出现第二个实例。
