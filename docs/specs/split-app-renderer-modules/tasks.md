# App.tsx 功能模块拆分任务清单
- [x] Task 1: 拆分消息展示相关模块
    - 1.1: 新建 `features/messages/message-model.ts`，迁移工具消息解析、消息体建模、角色文案、折叠预览等纯函数与类型
    - 1.2: 新建 `features/messages/MessageContent.tsx`，封装 Markdown 与纯文本两种消息体渲染方式
    - 1.3: 新建 `features/messages/MessageList.tsx`，承接消息列表映射、工具消息展开/收起、复制按钮、状态徽标与摘要展示
    - 1.4: 修改 `App.tsx`，接入消息模块并移除内联消息渲染逻辑

- [x] Task 2: 拆分设置面板相关模块
    - 2.1: 新建 `features/settings/settings-model.ts`，迁移配置表单归一化与多行输入拆分逻辑
    - 2.2: 新建 `features/settings/SettingsPanel.tsx`，封装设置区域表单 JSX 与字段更新回调
    - 2.3: 修改 `App.tsx`，改为组合设置面板组件并保持原保存逻辑不变

- [x] Task 3: 拆分输入区、执行状态与确认交互模块
    - 3.1: 新建 `features/composer/Composer.tsx`，封装输入框、发送、取消与键盘提交交互
    - 3.2: 新建 `features/activity/ActivityPanel.tsx`，封装执行中状态展示
    - 3.3: 新建 `features/confirmation/ConfirmationPanel.tsx`，封装工具确认卡片
    - 3.4: 新建 `features/context-menu/MessageContextMenu.tsx`，封装右键复制菜单
    - 3.5: 修改 `App.tsx`，接入上述组件并保留现有执行/确认/复制行为

- [x] Task 4: 收敛顶层容器并验证重构结果
    - 4.1: 清理 `App.tsx` 中已迁移的类型、辅助函数与冗余 JSX，确保职责聚焦在状态编排与布局
    - 4.2: 检查新增模块的导入导出与共享类型依赖，确保不破坏现有 IPC 和共享契约
    - 4.3: 运行类型检查或等效验证，修复拆分过程中产生的编译问题
    - 4.4: 完成后更新任务勾选状态，准备生成重构总结
