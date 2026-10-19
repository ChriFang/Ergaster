# MCP 服务编辑界面交互与尺寸修复任务清单
- [x] 任务 1：修复 MCP 服务面板点击遮罩自动关闭的问题
    - 1.1：修改 `src/renderer/App.tsx` 中 MCP modal 的 overlay 关闭逻辑
    - 1.2：确保点击弹窗外部区域时不关闭 MCP 服务面板
    - 1.3：保留通过面板内“关闭”按钮显式关闭 MCP 面板的能力

- [x] 任务 2：缩小 MCP 编辑页“参数”和“环境变量”输入框默认尺寸
    - 2.1：修改 `src/renderer/features/mcp/McpServersPanel.tsx`，为两个文本框切换到专用样式类
    - 2.2：修改 `src/renderer/styles.css`，新增 MCP 编辑页专用 textarea 样式
    - 2.3：将默认高度调整为原 `.agent-textarea` 的约 1/4，即约 `90px`
    - 2.4：保留多行输入与垂直拖拽调整能力

- [x] 任务 3：完成验证与交付收尾
    - 3.1：自查 MCP 面板关闭行为和两个文本框的显示效果
    - 3.2：执行 `npm run typecheck` 与 `npm run build`
    - 3.3：回写 `tasks.md` 勾选状态，并在完成后生成 `summary.md`
