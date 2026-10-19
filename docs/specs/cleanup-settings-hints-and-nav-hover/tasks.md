# 清理设置提示与补充左侧 tab hover 态任务计划

- [✓] Task 1: 删除通用设置底部 API Key 提示
    - 1.1: 在 `SettingsPanel.tsx` 中定位底部 `settings-actions settings-actions-column`
    - 1.2: 删除 `保存时不会在界面和日志中展示明文 API Key。` 提示节点
    - 1.3: 保留保存按钮、表单提交和保存状态展示逻辑

- [✓] Task 2: 删除 MCP 设置配置路径显示
    - 2.1: 在 `McpServersPanel.tsx` 中删除 `配置: {configPath}` 显示节点
    - 2.2: 清理不再使用的 `configPath` state
    - 2.3: 清理不再使用的 `window.desktopApp.getMcpConfigPath()` 调用
    - 2.4: 保留 MCP 列表、编辑、默认绑定和加载逻辑

- [✓] Task 3: 增加设置左侧 tab hover 态
    - 3.1: 在 `styles.css` 中为非 active 的 `.settings-dialog-nav-item` 添加 hover 样式
    - 3.2: 使用类似 `agent-ui` 的中性 sidebar accent 背景和文字提亮
    - 3.3: 保持 active tab 青色弱背景不被 hover 覆盖
    - 3.4: 避免新增边框、阴影或尺寸变化

- [✓] Task 4: 验证改动并生成总结
    - 4.1: 运行 `npm run typecheck` 验证类型检查
    - 4.2: 运行 `npm run build` 验证构建
    - 4.3: 检查 `git diff` 确认改动范围
    - 4.4: 生成 `summary.md` 记录完成内容和验证结果
