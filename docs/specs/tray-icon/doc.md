# 托盘图标与关闭行为（tray-icon）

> **修订记录**
> - rev1（2026-09-24）：初版，`trayEnabled` 可配置 + `closeAction` 三态。
> - rev2（2026-09-24）：按用户要求，**托盘图标改为强制开启，不再提供配置**；移除 `trayEnabled` 字段与设置页开关；`closeAction` 关闭行为配置保留。
> - rev3（2026-09-24）：按用户要求，「关闭按钮行为」从 `<select>` 下拉改为**分段按钮组**（横排三项、每项带边框、选中项青色描边，同思考强度 Low/High/Max 截图样式），并将该设置项**移到设置页最后**（GitHub Token 之后、保存按钮之前）。本文档为 rev3 现行设计。

## 需求场景与处理逻辑

1. **托盘图标强制开启**：Windows 下启动即创建系统托盘图标，无配置项、无开关；mac 不做托盘（保持原生关窗不退出习惯）。
2. **首次关闭弹窗询问，选择落盘**：`closeAction` 配置项（`'ask' | 'minimize' | 'exit'`，默认 `'ask'`）决定点窗口关闭按钮（X）的行为。"首次关闭"即 `closeAction === 'ask'` 的状态——弹窗让用户选择「最小化到托盘」或「退出」，选择结果写回配置，之后按已落盘的选择执行。设置页「关闭按钮行为」下拉可随时改（含改回"每次询问"）。

已确认的设计决策：

- **`closeAction` 三态字段**：`'ask' | 'minimize' | 'exit'`；托盘常驻后，点 X 的去向完全由 `closeAction` 决定（rev1 的"托盘关闭时直接退出"分支随 `trayEnabled` 一并移除）。
- **弹窗提供"取消"**：三按钮「最小化到托盘 / 退出 / 取消」，Esc 或关闭弹窗 = 取消，本次不关闭窗口、不落盘。
- **单实例锁**：`requestSingleInstanceLock`，第二实例启动时唤起已运行实例的主窗口。
- **Windows 为主**：拦截/弹窗/托盘仅在 win32 生效；mac 保持现有原生习惯。

## 架构与技术方案

### 关闭行为决策（纯函数，可单测）

放在 `src/shared/config.ts`（零依赖）：

```ts
export type WindowCloseAction = 'ask' | 'minimize' | 'exit';
export type CloseBehavior = 'ask' | 'minimize' | 'exit' | 'native';

/** 决定点 X 的去向：mac 走平台默认（关窗不退出）；win32 按配置。 */
export function resolveCloseBehavior(closeAction: WindowCloseAction, platform: string): CloseBehavior {
  if (platform !== 'win32') {
    return 'native';
  }
  return closeAction;
}
```

### 主进程：托盘服务（`src/main/tray/tray-service.ts`，不变）

`initTrayService` 注入窗口句柄；`createTray`（幂等 + win32 校验 + `assets/icon.ico` + 菜单「打开主窗口/退出」+ 左键 click 唤起）；`destroyTray`；`showMainWindow`。托盘强制开启后 `destroyTray` 仅在测试/未来场景可达，保留导出。

### 主进程：`src/main/index.ts` 改动（rev2 delta）

1. **单实例锁**：不变（顶层 `requestSingleInstanceLock`，`second-instance` → `showMainWindow`，`whenReady` 首行守卫）。
2. **`isQuitting`**：不变（`before-quit` 置位）。
3. **close 拦截 + `handleWindowCloseRequest`**：逻辑不变，调用点适配新签名 `resolveCloseBehavior(config.closeAction, process.platform)`。
4. **托盘初始化**：去掉配置判断，win32 无条件创建：

```ts
// 托盘强制开启（仅 Windows；mac 不做托盘）
if (process.platform === 'win32') {
  createTray();
}
```

5. **`config:save` handler**：还原为直通 `saveConfig(payload)`（托盘开关同步逻辑随 `trayEnabled` 移除）。

### 共享配置：`src/shared/config.ts`

- `AppConfig` 仅含 `closeAction: WindowCloseAction`（rev2 移除 `trayEnabled`）。
- `defaultConfig`：`closeAction: 'ask'`；`sanitizeConfig`/`sanitizeCloseAction` 只处理 `closeAction`。
- **旧配置兼容**：rev1 期间落盘的 `config.json` 可能含 `trayEnabled` 字段——`sanitizeConfig` 显式重建返回对象，未知字段自然丢弃，无需迁移。

### Renderer 设置页（rev2 delta）

- 移除「托盘图标」开关：`SettingsPanel.tsx` 删除该块；`use-settings-state.ts` 删除 `handleTrayEnabledChange` 及导出；`App.tsx` 删除对应 prop 接线；`config-form.ts`/`settings-model.ts` 移除 `trayEnabled` 字段。
- 「关闭按钮行为」下拉**保留并始终渲染**（原 `formValues.trayEnabled ? ...` 条件移除），说明文案去掉"托盘关闭时点关闭按钮将直接退出"。
- `openSettingsDialog` 打开 general tab 时重拉配置**保留**（`closeAction` 仍会被主进程关闭弹窗落盘更新，需防表单陈旧）。

## 受影响文件（rev2 delta）

| 文件 | 类型 | 改动点 |
|---|---|---|
| `e:\my-project\desktop-tools\src\shared\config.ts` | 修改 | 移除 `trayEnabled`；`resolveCloseBehavior` 改签名 `(closeAction, platform)` |
| `e:\my-project\desktop-tools\src\main\index.ts` | 修改 | 托盘初始化无条件创建；`config:save` 还原直通；close 决策调用点适配 |
| `e:\my-project\desktop-tools\src\renderer\config-form.ts` | 修改 | 移除 `trayEnabled` |
| `e:\my-project\desktop-tools\src\renderer\features\settings\settings-model.ts` | 修改 | 移除 `trayEnabled` |
| `e:\my-project\desktop-tools\src\renderer\lib\hooks\use-settings-state.ts` | 修改 | 移除 `handleTrayEnabledChange` 及导出 |
| `e:\my-project\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx` | 修改 | 删除托盘开关块；关闭行为下拉去掉条件渲染并更新文案 |
| `e:\my-project\desktop-tools\src\renderer\App.tsx` | 修改 | 移除 `onTrayEnabledChange` 接线 |
| `e:\my-project\desktop-tools\src\shared\config.test.ts` | 修改 | 移除 `trayEnabled` 用例；决策矩阵适配新签名 |
| `e:\my-project\desktop-tools\src\main\tray\tray-service.ts` | 不变 | — |

## 数据流（rev2）

- **关闭行为设置**：SettingsPanel 下拉 → `handleCloseActionChange` → `config:save` 落盘 → 返回 masked config 回填表单。
- **点 X**（win32、未在退出中）：close 事件 → 同步 `preventDefault` → 异步 `loadConfig` → `resolveCloseBehavior(config.closeAction, platform)` → `ask` 弹窗（选择落盘 + hide/quit）｜`minimize` 直接 hide｜`exit` 置位 + quit。
- **托盘**：启动即创建；点击图标/菜单「打开主窗口」→ `showMainWindow`；菜单「退出」→ `app.quit()` → `before-quit` 置 `isQuitting` → close 放行 → 退出。
- **第二实例**：不变。

## 边界条件与异常处理（rev2）

- **mac**：不注册 close 拦截、不建托盘、`resolveCloseBehavior` 返回 `'native'`。
- **托盘常驻**：不再存在"托盘关闭"状态；点 X 行为完全由 `closeAction` 决定。
- **弹窗选择落盘失败**：catch 后记主日志，hide/quit 照常执行（fail-open）。
- **配置文件损坏**：`loadConfig` 回退 `defaultConfig`（`closeAction: 'ask'`）。
- **旧配置兼容**：磁盘遗留 `trayEnabled` 字段被 sanitize 自然丢弃。
- **isQuitting 贯穿所有退出源**：不变。
- **同步拦截时序**：不变（close 内同步 preventDefault，再异步决策）。
- **未持锁实例**：不变。
- **流式任务不受影响**：窗口 hide 后任务继续流式执行。

## 已知取舍

- 系统关机/注销时 'ask' 模式可能短暂弹窗后被系统强杀——不做特殊处理。
- 退出时不额外提示"任务正在执行"。

## 预期结果（rev2）

1. Windows 启动即显示托盘图标，设置页无托盘开关。
2. 首次点 X 弹窗三选一并落盘；之后按已落盘选择执行。
3. 设置页仅剩「关闭按钮行为」下拉（始终渲染），可随时修改。
4. 双击图标二次启动唤起已有主窗口，不双开。
5. `npm run typecheck` 与 `npm test` 通过（测试适配新签名）。
