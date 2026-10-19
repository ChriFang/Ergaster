# 侧边栏与顶部菜单重构任务计划

- [x] Task 1: 修改 App.tsx 新增状态与逻辑
    - 1.1: 新增 `inputHistory`、`isMenuOpen`、`showAboutModal` 状态和 `menuRef` ref
    - 1.2: 在 `handleRunAgent` 中添加输入历史更新逻辑（FIFO，最多 100 条）
    - 1.3: 新增点击外部关闭菜单的 `useEffect`
    - 1.4: 新增处理函数 `handleHistoryClick`（点击输入记录回填到输入框）

- [x] Task 2: 修改 App.tsx 重构 Sidebar JSX
    - 2.1: 重构 sidebar 结构为「品牌区 + 可滚动内容区」
    - 2.2: 移除「DeepSeek 配置」和「应用状态」状态卡片
    - 2.3: 新增「智能体」区块（静态列表展示）
    - 2.4: 新增「输入记录」区块（列表展示、支持滚动、点击回填）

- [x] Task 3: 修改 App.tsx 重构 Header JSX 和新增关于弹窗
    - 3.1: 将「Skills 管理」「设置」「关于」收纳到「菜单」下拉面板
    - 3.2: 「重置会话」保持为独立按钮
    - 3.3: 新增「关于」弹窗 JSX，展示应用状态信息
    - 3.4: 确保菜单操作后自动关闭菜单

- [x] Task 4: 修改 styles.css 新增和调整样式
    - 4.1: 调整 `.sidebar` 布局（移除 `justify-content: space-between`，内容区 `flex: 1`）
    - 4.2: 新增 dropdown 相关样式（`.dropdown`、`.dropdown-menu`、`.dropdown-item`、`.dropdown-divider`）
    - 4.3: 新增 modal 弹窗样式（`.modal-overlay`、`.modal-content`）
    - 4.4: 新增 sidebar section 相关样式（`.sidebar-content`、`.sidebar-section`、`.sidebar-section-title`）
    - 4.5: 新增 agent list 相关样式（`.agent-list`、`.agent-item`）
    - 4.6: 新增 history list 相关样式（`.history-list`、`.history-item`、`.history-empty`）
