# 智能体头像颜色块迁移任务计划

- [x] Task 1: 迁移智能体头像颜色选择器
    - 1.1: 调整 `AgentEditor.tsx` 中头像颜色按钮结构
    - 1.2: 移除颜色按钮内的图标和文字标签展示
    - 1.3: 为颜色块按钮补充 `aria-label` 和 `aria-pressed`
    - 1.4: 在 `styles.css` 中新增颜色块按钮基础态、hover 态、禁用态和选中变大态

- [x] Task 2: 迁移设置页智能体列表头像
    - 2.1: 在 `AgentsPanel.tsx` 中增加智能体名称首字生成逻辑
    - 2.2: 将列表项中的 `Bot` 图标替换为“颜色块 + 名称首字”头像
    - 2.3: 清理不再使用的 `Bot` import
    - 2.4: 在 `styles.css` 中补充设置页头像尺寸、圆角、文字和颜色样式

- [x] Task 3: 迁移主界面侧栏智能体头像
    - 3.1: 在 `SidebarPanel.tsx` 中增加智能体名称首字生成逻辑
    - 3.2: 为非默认智能体项增加头像节点和文本容器
    - 3.3: 保持默认模式、历史记录列表和设置入口结构不变
    - 3.4: 在 `styles.css` 中补充侧栏头像尺寸和带头像列表项布局

- [x] Task 4: 验证迁移结果并生成总结
    - 4.1: 检查 `tasks.md` 中已完成任务状态
    - 4.2: 运行 `npm run typecheck`
    - 4.3: 运行 `npm run build`
    - 4.4: 生成 `.comate/specs/agent-avatar-color-blocks/summary.md`
