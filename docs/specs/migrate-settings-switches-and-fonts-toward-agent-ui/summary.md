# 设置界面开关按钮与字体风格迁移结果

## 完成内容
- 已将 Skills 管理页列表中的启用入口替换为接近 `agent-ui` 的紧凑型 switch。
- 已将 MCP 管理页列表中的启用入口替换为同一套 switch 样式。
- 已将 Skill 编辑界面的启用状态控件替换为 switch + 文案布局。
- 已将 MCP 编辑界面的状态控件替换为 switch + 文案布局。
- 已在设置弹窗范围内引入接近 `agent-ui` 的无衬线字体栈与等宽字体栈。
- 已收口设置标题、描述、字段标签、输入框、说明文字与列表描述的字号和字重表现。

## 影响文件
- `src/renderer/features/skills/SkillsPanel.tsx`
- `src/renderer/features/skills/SkillEditor.tsx`
- `src/renderer/features/mcp/McpServersPanel.tsx`
- `src/renderer/styles.css`

## 验证结果
- 已通过 `npm run typecheck`
- 已通过 `npm run build`

## 结果说明
- 设置弹窗中的 Skills / MCP 开关控件现在与 `agent-ui` 的滑块式 switch 观感更接近。
- 设置弹窗内的标题、说明、表单与元信息字体更统一，并与 `agent-ui` 的字重和字号层级更接近。
- 本轮仅调整 renderer 展示层，未改动共享合同、IPC 或持久化逻辑。