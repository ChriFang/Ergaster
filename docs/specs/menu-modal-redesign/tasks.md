# UI操作优化：菜单按钮改为弹窗显示

- [x] Task 1: 修改 App.tsx 状态管理
    - 1.1: 新增 `showSkillsModal` 和 `showSettingsModal` 状态变量
    - 1.2: 移除不再需要的 `showSkillsPanel` 和 `showSettings` 状态
    - 1.3: 清理相关的状态导入和内联逻辑

- [x] Task 2: 修改菜单按钮行为
    - 2.1: 更新 "Skills 管理" 按钮：打开 Modal，固定文本为 "Skills 管理"
    - 2.2: 更新 "设置" 按钮：打开 Modal，固定文本为 "设置"
    - 2.3: 移除按钮文本的动态切换逻辑

- [x] Task 3: 添加 Modal 渲染
    - 3.1: 在 App 组件末尾添加 Skills Modal（使用现有 modal-overlay 样式）
    - 3.2: 在 App 组件末尾添加 Settings Modal
    - 3.3: 确保 Modal 支持点击遮罩关闭

- [x] Task 4: 移除面板显示逻辑
    - 4.1: 从 chat-scroll-area 中移除 SkillsPanel 条件渲染
    - 4.2: 从 chat-scroll-area 中移除 SettingsPanel 条件渲染
    - 4.3: 清理不再使用的组件属性传递

- [x] Task 5: 添加 Modal 样式
    - 5.1: 添加 `.skills-modal` 样式（宽度、高度、溢出处理）
    - 5.2: 添加 `.settings-modal` 样式（宽度、高度、溢出处理）
    - 5.3: 调整 SkillsPanel 在 Modal 中的内边距
