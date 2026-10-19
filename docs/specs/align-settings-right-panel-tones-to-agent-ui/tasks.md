# 设置界面右侧板块色调向 agent-ui 对齐任务计划

- [x] Task 1: 收口设置右侧整体背景与主卡片色调
    - 1.1: 调整 `.settings-dialog-content` 为更平缓的深蓝黑基底
    - 1.2: 降低 `.settings-panel-embedded`、`.skills-panel`、`.about-panel-card` 的默认背景浓度
    - 1.3: 将 `.settings-surface-card` 统一为低透明 muted/card 层级
    - 1.4: 保留现有滚动、布局、圆角和尺寸行为

- [x] Task 2: 统一管理面板和关于卡片的内部层级
    - 2.1: 收敛 `.skills-panel`、`.agents-panel` 的重复渐变和阴影定义
    - 2.2: 调整 `.about-panel-card` 与通用设置卡片保持同一色调层级
    - 2.3: 确保通用设置、智能体、Skills、MCP、关于页面右侧主板块视觉一致

- [x] Task 3: 收口列表项、选择项和辅助区色调
    - 3.1: 降低 `.skill-item`、`.agent-mcp-added-item` 的背景浓度并统一边框
    - 3.2: 为列表项补充克制 hover 反馈
    - 3.3: 调整 `.agent-color-chip`、`.agent-selection-chip`、`.settings-toggle-button` 默认、hover、active 色调
    - 3.4: 调整 `.settings-checkbox-row`、`.editor-hint`、`.editor-hint pre` 的 muted 层级

- [x] Task 4: 对齐输入控件焦点 ring 表达
    - 4.1: 降低输入框、文本域、select、编辑器 textarea 的默认背景浓度
    - 4.2: 将 focus 态从单纯边框变化扩展为轻量青色 ring
    - 4.3: 保持上一轮已收口的控件高度、padding 和行高不变

- [x] Task 5: 验证改动并生成总结
    - 5.1: 运行 `npm run typecheck` 验证类型检查
    - 5.2: 运行 `npm run build` 验证构建
    - 5.3: 检查 `git diff` 确认只包含本次右侧板块色调相关改动
    - 5.4: 生成 `summary.md` 记录完成内容和验证结果
