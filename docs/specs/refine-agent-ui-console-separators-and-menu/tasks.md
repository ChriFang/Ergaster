# 对齐 agent-ui 的会话区分隔、思考模式提示与右键菜单尺寸的任务拆解
- [x] Task 1: 收敛右侧标题区、会话区、输入区的分隔结构
    - 1.1: 调整 `src/renderer/styles.css` 中 `console-panel`、`console-header`、`console-scroll-area`、`composer` 相关样式
    - 1.2: 将当前三段结构从“多卡片边框”收敛为更接近单线分隔的轻量层级
    - 1.3: 保留会话区网格背景，但降低外框和大圆角带来的厚重感
    - 1.4: 如有必要，在 `ConsolePanel.tsx` 中补充更清晰的 className 承载分隔语义

- [x] Task 2: 删除思考模式下方常驻说明文案并收紧输入区布局
    - 2.1: 在 `src/renderer/features/composer/Composer.tsx` 中移除“开启后模型会先进行推理，再输出最终答案。”文案节点
    - 2.2: 调整 `src/renderer/styles.css` 中 `composer-meta`、`composer-actions` 等样式，消除删除文案后的多余空白
    - 2.3: 保持思考模式开关、取消按钮、发送按钮的现有行为不变

- [x] Task 3: 缩小会话区右键菜单并统一风格
    - 3.1: 调整 `src/renderer/styles.css` 中 `message-context-menu` 的最小宽度、圆角、padding 和阴影
    - 3.2: 调整 `message-context-menu-item` 的 padding、字号和圆角，使其更紧凑
    - 3.3: 确认 `MessageContextMenu.tsx` 无需结构改动即可满足视觉收敛目标

- [x] Task 4: 完成验证并补充总结
    - 4.1: 检查默认模式、已选智能体、运行中、报错、确认卡片等场景的右侧区域显示完整性
    - 4.2: 执行 TypeScript 类型检查
    - 4.3: 执行构建验证
    - 4.4: 将本轮收敛结果写入 `summary.md`
