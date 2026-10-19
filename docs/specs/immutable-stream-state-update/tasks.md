# 以不可变状态更新修复流式文本重复追加任务计划
- [x] Task 1: 将流式 assistant 消息累积逻辑改为不可变更新
    - 1.1: 在 `src/renderer/App.tsx` 调整 `appendAssistantStreamDelta(...)`，不再原地修改 assistant 消息对象
    - 1.2: 在首次命中不到目标消息时，直接创建带初始 `content` / `reasoning_content` 的新 assistant 消息
    - 1.3: 保留 `streamMessageId` 定位与 `content_started` 切换逻辑，确保现有行为不回退

- [x] Task 2: 校验 renderer 渲染结果与开发模式行为
    - 2.1: 检查 `MessageList` 的 `body.text` 是否仍可能出现 `学习学习`、`Rust Rust` 这类内容级重复
    - 2.2: 确认保留 `React.StrictMode` 的前提下，流式内容不会因为 state mutation 被重复拼接

- [x] Task 3: 完成静态验证与总结
    - 3.1: 运行 `npm run typecheck`
    - 3.2: 运行 `npm run build`
    - 3.3: 生成本次修复的 `summary.md`
