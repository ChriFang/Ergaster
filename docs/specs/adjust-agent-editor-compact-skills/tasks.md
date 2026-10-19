# 调整 AgentEditor 顶部标题与 Skills 按钮密度

- [✓] Task 1: 移除智能体编辑顶部英文标题
    - 1.1: 删除 `AgentEditor.tsx` 顶部 header 中的 `<p className="eyebrow">Agent Editor</p>`
    - 1.2: 保留“创建智能体/编辑智能体”中文标题
    - 1.3: 保留当前说明文案和错误提示位置

- [✓] Task 2: 缩小关联 Skills 按钮显示
    - 2.1: 在 `styles.css` 中压缩 `.agent-selection-chip` 的间距、高度、内边距和字号
    - 2.2: 压缩 `.agent-chip-list` 的按钮间距
    - 2.3: 避免影响 `.settings-toggle-button` 的现有尺寸表现
    - 2.4: 将 AgentEditor 中 chip 图标尺寸从 14 调小到 12

- [✓] Task 3: 验证 UI 调整
    - 3.1: 运行 TypeScript 类型检查
    - 3.2: 确认顶部不再显示“Agent Editor”
    - 3.3: 确认 Skills 和 MCP 关联按钮仍可点击并保留选中态
