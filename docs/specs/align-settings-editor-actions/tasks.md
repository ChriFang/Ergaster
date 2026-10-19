# 设置界面编辑操作按钮右对齐任务计划

- [✓] Task 1: 调整通用设置保存交互
    - 1.1: 在 App.tsx 中包装 SettingsPanel 的 onSubmit，保存成功后调用 closeSettingsDialog
    - 1.2: 在 use-settings-state.ts 中移除成功保存后的“配置已保存。”状态文本
    - 1.3: 在 SettingsPanel.tsx 中移除 saveStatus prop 与保存状态文本渲染
    - 1.4: 保留表单提交、配置保存和字段绑定逻辑不变

- [✓] Task 2: 统一编辑器和通用设置操作按钮右对齐
    - 2.1: 在 styles.css 中将 .editor-actions 设置为 flex 右对齐布局
    - 2.2: 在 styles.css 中将 .settings-actions 设置为 flex 右对齐布局
    - 2.3: 调整 .settings-actions-column，避免原有居中规则覆盖右对齐
    - 2.4: 确认智能体、Skill、MCP 编辑器按钮复用右对齐样式

- [✓] Task 3: 移除 MCP 编辑器英文标题
    - 3.1: 在 McpServersPanel.tsx 中删除 <p className="eyebrow">MCP Editor</p>
    - 3.2: 保留“编辑 MCP 服务”和“新增 MCP 服务”中文标题
    - 3.3: 确认默认模式 MCP 的 Default Binding 文本不受影响

- [✓] Task 4: 验证本次设置界面调整
    - 4.1: 搜索确认 “MCP Editor” 与 “配置已保存。” 不再出现在目标界面逻辑中
    - 4.2: 运行 npm run typecheck
    - 4.3: 生成 summary.md 记录完成内容与验证结果
