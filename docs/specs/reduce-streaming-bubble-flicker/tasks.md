# 流式气泡切换抖动修复任务清单
- [x] Task 1: 合并单个流式 delta 的前端事件分发
    - 1.1: 修改 `src/main/deepseek-client.ts`，将同一 delta 中的 `reasoning_content` 与 `content` 聚合到一次 `onChunk(...)` 调用中
    - 1.2: 保持 `tool_calls` 聚合逻辑不变，确保工具调用链路不受影响
    - 1.3: 验证 reasoning-only、content-only、reasoning+content 同时出现三类 chunk 的事件行为

- [x] Task 2: 提前正文开始判定并同步调整 assistant 气泡切换逻辑
    - 2.1: 在 `src/shared/agent.ts` 中为 `AgentMessage` 增加前端展示辅助字段 `content_started?`
    - 2.2: 在 `src/renderer/App.tsx` 的流式 assistant 临时消息中维护 `content_started` 标记
    - 2.3: 在 `src/renderer/features/messages/MessageList.tsx` 中优先根据 `content_started` 判断是否隐藏思考气泡
    - 2.4: 保持最终快照覆盖逻辑不变，兼容没有 `content_started` 的历史消息

- [x] Task 3: 验证流式切换抖动修复结果
    - 3.1: 检查 reasoning-only、正文首字符为空白、reasoning 与 content 同 chunk 返回三类场景的显示行为
    - 3.2: 确认独立思考气泡、正文气泡、工具消息三类渲染路径不互相影响
    - 3.3: 运行 TypeScript 类型检查并修复可能的类型问题
    - 3.4: 运行构建验证 renderer、main、preload 均可正常打包
