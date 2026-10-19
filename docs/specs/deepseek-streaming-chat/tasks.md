# DeepSeek 模型结果流式显示任务清单
- [x] Task 1: 改造 DeepSeek 客户端支持流式响应解析
    - 1.1: 在 `src/main/deepseek-client.ts` 中补充流式 chunk 类型与回调参数定义
    - 1.2: 将 Chat Completions 请求体改为携带 `stream: true`
    - 1.3: 实现 SSE 文本流读取、分帧与 `data:` 行解析
    - 1.4: 分别累计 `reasoning_content` 与 `content` 增量并通过回调上抛
    - 1.5: 聚合流式返回的 `tool_calls` 片段并生成最终 assistant message

- [x] Task 2: 打通 Main 进程到 Renderer 的流式事件通道
    - 2.1: 在 `src/shared/agent.ts` 中新增流式事件类型，并按需扩展 `AgentMessage`
    - 2.2: 在 `src/main/agent-service.ts` 中增加流式监听/分发能力并改用流式模型调用
    - 2.3: 在 `src/main/index.ts` 中把 Agent 流式事件转发为 `agent:stream` IPC 消息
    - 2.4: 在 `src/shared/contracts.ts` 与 `src/preload/index.ts` 中暴露 `onAgentStream` 订阅接口

- [x] Task 3: 改造渲染层实现消息流式展示
    - 3.1: 在 `src/renderer/App.tsx` 中订阅 `onAgentStream` 并管理解绑
    - 3.2: 在发送请求后维护当前轮次的 assistant 临时消息占位
    - 3.3: 在收到流式增量时拼接 assistant 的 `content` / `reasoning_content`
    - 3.4: 在请求完成、失败或取消时用最终消息快照校正界面状态与运行状态文案

- [x] Task 4: 验证流式链路与现有工具调用兼容性
    - 4.1: 检查消息渲染模型对新增字段的兼容性，必要时调整 `message-model.ts`
    - 4.2: 运行 TypeScript 类型检查，修复流式改造引入的类型问题
    - 4.3: 运行构建验证主进程、preload 和 renderer 均可正常打包
    - 4.4: 复查 tool call 回合、取消逻辑与错误回退是否保持现有行为
