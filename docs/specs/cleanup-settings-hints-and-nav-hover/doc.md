# 清理设置提示与补充左侧 tab hover 态

## 需求场景与处理逻辑

用户希望继续参考 `E:\other-code\agent-ui` 对设置界面做小范围调整：

1. 通用设置界面去掉底部提示文案：“保存时不会在界面和日志中展示明文 API Key。”
2. MCP 设置界面去掉 MCP 配置路径显示。
3. 设置界面左侧设置项 tab 在鼠标 hover 时增加 hover 态，参考 `agent-ui`。

处理逻辑：

- 前两项是界面信息清理，只删除对应渲染，不改变保存、加载、MCP 配置读取和业务行为。
- 第三项是纯 CSS 交互态补充，不改变 tab 结构与切换逻辑。
- 左侧 tab hover 参考 `agent-ui` 的 `hover:bg-sidebar-accent hover:text-foreground`：非 active 项 hover 时只做中性底色变亮和文字提亮，不增加边框，避免抢 active 的青色视觉层级。

## 架构与技术方案

### 当前项目定位

- 通用设置由 `SettingsPanel` 渲染。
- MCP 设置由 `McpServersPanel` 渲染。
- 设置弹窗左侧 tab 由 `SettingsDialogShell` 输出 className：`settings-dialog-nav-item` 和 `settings-dialog-nav-item-active`。
- hover 只需在 `src/renderer/styles.css` 中补 `.settings-dialog-nav-item:hover:not(.settings-dialog-nav-item-active)`。

### agent-ui 参考

`E:\other-code\agent-ui\components\settings-dialog.tsx` 中左侧 nav item 的核心逻辑：

```tsx
tab === item.id
  ? "bg-primary/10 text-primary"
  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
```

迁移到 `desktop-tools` 时保持：

- active 态继续使用现有青色弱背景。
- hover 态使用中性 sidebar accent 风格。
- hover 不加边框，不改变尺寸。

## 受影响文件

### `E:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx`

修改类型：删除 JSX 文案。

当前位置：`SettingsPanel.tsx` 的底部操作区：

```tsx
<div className="settings-actions settings-actions-column">
  <span className="hint">保存时不会在界面和日志中展示明文 API Key。</span>
  <button className="primary-button" type="submit">
    保存配置
  </button>
</div>
```

计划调整：删除 `<span className="hint">保存时不会在界面和日志中展示明文 API Key。</span>`，保留保存按钮和表单提交行为。

### `E:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`

修改类型：删除配置路径显示。

当前显示位置：

```tsx
{configPath ? <span className="skills-directory">配置: {configPath}</span> : null}
```

计划调整：删除该 JSX。若 `configPath` state 和 `getMcpConfigPath()` 调用不再被使用，则同步清理对应 state 与 effect 调用，避免保留无用代码。

### `E:\other-code\desktop-tools\src\renderer\styles.css`

修改类型：新增 hover 样式。

计划新增：

```css
.settings-dialog-nav-item:hover:not(.settings-dialog-nav-item-active) {
  border-color: transparent;
  background: rgba(148, 163, 184, 0.12);
  color: #f8fafc;
}
```

如需更接近当前深色侧栏，可使用 `rgba(120, 139, 164, 0.14)`，但不增加阴影和边框。

## 边界条件与异常处理

- 删除通用设置底部提示不影响 API Key 输入、保存和状态提示。
- 删除 MCP 配置路径显示不影响 MCP 配置文件的读取、写入、编辑、默认绑定等逻辑。
- 若删除路径显示后 `configPath` 不再使用，需要同步删除 state 与 `getMcpConfigPath()` 调用，避免 TypeScript 未使用变量错误。
- 左侧 tab active 项 hover 时应保持 active 样式，不被普通 hover 覆盖。
- hover 样式不改变 padding、border 宽度、字体大小，避免鼠标悬停时布局抖动。

## 数据流路径

- 通用设置：`App.tsx` 的 `general` tab 渲染 `SettingsPanel`，删除底部 hint 只影响 JSX 输出。
- MCP 设置：`App.tsx` 的 `mcp` tab 渲染 `McpServersPanel`，删除配置路径显示后列表和编辑功能保持原路径。
- 左侧 tab：`SettingsDialogShell` 输出 tab button，`styles.css` 控制 hover 视觉反馈。

## 预期结果

- 通用设置底部不再展示 API Key 明文安全提示。
- MCP 设置顶部工具栏不再展示 MCP 配置路径。
- 设置界面左侧非 active tab 在 hover 时出现类似 `agent-ui` 的中性背景提亮和文字提亮。
- 现有保存、MCP 管理、tab 切换行为不变。

## 验证方式

- 运行 `npm run typecheck`，确认无未使用变量和类型错误。
- 运行 `npm run build`，确认构建通过。
- 检查 `git diff`，确认改动仅覆盖本次三项需求和对应 spec 文件。
