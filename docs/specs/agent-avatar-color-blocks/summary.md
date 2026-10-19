# 智能体头像颜色块迁移总结

## 完成内容

- 已将智能体编辑器中的“头像颜色”设置项迁移为具体颜色块按钮。
- 已移除颜色选择按钮中的图标和文字标签展示，改为通过真实色块表达颜色。
- 已为颜色块按钮补充 `aria-label` 和 `aria-pressed`，保留可访问语义。
- 已实现颜色块选中后变大，并补充 hover、focus-visible、disabled 状态。
- 已将设置页智能体列表中的 `Bot` 图标替换为“颜色块 + 名称首字”头像。
- 已将主界面左侧边栏的智能体项增加“颜色块 + 名称首字”头像。
- 已保持默认模式、历史记录列表和设置入口结构不变。

## 修改文件

- `src/renderer/features/agents/AgentEditor.tsx`
  - 头像颜色选项从图标按钮改为色块按钮。
  - 删除不再使用的 `Palette` 图标 import。

- `src/renderer/features/agents/AgentsPanel.tsx`
  - 删除不再使用的 `Bot` 图标 import。
  - 增加 `getAgentInitial()`，用于生成智能体名称首字。
  - 设置页智能体列表头像改为色块 + 首字。

- `src/renderer/features/layout/SidebarPanel.tsx`
  - 增加 `getAgentInitial()`，用于生成智能体名称首字。
  - 主侧栏非默认智能体项增加头像节点和文本容器。

- `src/renderer/styles.css`
  - 新增 `.agent-avatar`、`.agent-avatar-settings`、`.agent-avatar-sidebar`。
  - 新增 `.agent-avatar-cyan|blue|violet|emerald|amber|rose` 实色背景。
  - 新增 `.agent-color-swatch`、hover、focus-visible、disabled、active 选中变大态。
  - 调整带头像侧栏智能体项布局与标题截断。

## 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过。

## 说明

- 本次未修改 `AgentAvatarColor` 类型、IPC、主进程读写逻辑或本地智能体配置文件格式。
- 现有 `avatarColor` 数据流已满足设置页和主侧栏头像渲染需求。
- 名称为空或全空白时，头像首字显示 `?`。
