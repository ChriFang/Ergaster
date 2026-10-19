# markdown-message-rendering 任务拆解
- [x] Task 1: 调整 tool 消息正文判定逻辑并接入 Markdown 渲染
    - 1.1: 在 `src/renderer/App.tsx` 中区分 tool 消息的 `error`、`content` 与 `data` 展示类型
    - 1.2: 对 tool 消息中的 `error` 与 `content` 复用现有 Markdown 渲染能力
    - 1.3: 保持 `payload.data` 继续使用预格式化文本展示，避免结构化数据被错误解释为 Markdown
    - 1.4: 保持 assistant、user 消息现有渲染行为不被回退

- [x] Task 2: 保持复制与交互能力兼容
    - 2.1: 复制按钮继续复制 tool 卡片对应的原始文本内容
    - 2.2: 右键复制选中内容继续在 Markdown 渲染后的 DOM 中可用
    - 2.3: 保持 tool 状态标签、参数摘要与错误卡片样式不受影响

- [x] Task 3: 补充样式边界并覆盖 tool Markdown 展示场景
    - 3.1: 复用现有 `.message-markdown` 样式支持 tool 卡片中的标题、列表、引用、代码块、表格与链接
    - 3.2: 确保宽表格与长代码块在 tool 卡片中仍具备横向滚动能力
    - 3.3: 保持 tool 卡片布局与当前最大宽度约束一致

- [x] Task 4: 验证类型检查与构建结果
    - 4.1: 执行 `npm run typecheck`
    - 4.2: 执行 `npm run build`
    - 4.3: 若出现问题，修复本次改动引入的错误并重新验证
