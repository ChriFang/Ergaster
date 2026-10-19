# 智能体关联 Skill 运行时生效任务计划

- [x] Task 1: 实现智能体 Skill 运行时过滤逻辑
    - 1.1: 在 `src/main/tool-registry.ts` 中新增根据 `agentId` 获取允许 Skill 名称集合的辅助函数
    - 1.2: 将 `getUserTools()` 调整为接收 `agentId` 并按智能体 `skillNames` 过滤用户 Skill tools
    - 1.3: 将 `getRuntimeTools(agentId)` 调整为向 `getUserTools(agentId)` 传递当前智能体标识
    - 1.4: 保持未选择智能体时返回全部已加载用户 Skills 的现有行为
    - 1.5: 保持智能体不存在或未关联 Skill 时不暴露用户 Skill 的安全默认行为

- [x] Task 2: 验证工具暴露与执行侧拦截一致
    - 2.1: 检查 `getRegisteredToolsForAgent({ agentId })` 使用过滤后的 runtime tools 生成模型可见 tools
    - 2.2: 检查 `executeToolCall(toolCall, signal, { agentId })` 使用同一过滤后的 runtime tools 构建执行映射
    - 2.3: 确认未关联 Skill 不会进入模型 tools，也不会在执行阶段被调用
    - 2.4: 确认系统工具和 MCP 绑定逻辑不受影响

- [x] Task 3: 运行静态检查并处理问题
    - 3.1: 执行 `npm run typecheck`
    - 3.2: 如出现类型错误，定位并修复与本次改动相关的问题
    - 3.3: 复查 `tasks.md` 并更新已完成任务状态
