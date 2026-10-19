# 智能体系统提示词可选任务计划

- [✓] Task 1: 放开前端系统提示词必填校验
    - 1.1: 修改 `src/renderer/features/agents/AgentEditor.tsx` 的 `handleSave()`
    - 1.2: 删除 `normalizedContent` 为空时提示“请输入系统提示词。”并阻止提交的逻辑
    - 1.3: 保留名称和描述必填校验
    - 1.4: 保留 `content.trim()` 后提交，确保纯空白内容保存为空字符串

- [✓] Task 2: 放开主进程保存与加载校验
    - 2.1: 修改 `src/main/agent-profiles-service.ts` 的 `createAgent(request)`
    - 2.2: 删除创建智能体时 `content` 为空返回“智能体内容不能为空”的逻辑
    - 2.3: 修改 `src/main/agent-profiles-service.ts` 的 `updateAgent(request)`
    - 2.4: 删除更新智能体时 `content` 为空返回“智能体内容不能为空”的逻辑
    - 2.5: 修改 `loadAgentFromDirectory(directoryPath)`，允许空 `AGENT.md` 加载为有效智能体

- [✓] Task 3: 验证类型检查与行为链路
    - 3.1: 检查运行时 `agent-service.ts` 对空系统提示词不注入 system message 的现有逻辑无需修改
    - 3.2: 执行 `npm run typecheck`
    - 3.3: 如出现类型错误，定位并修复与本次改动相关的问题
    - 3.4: 复查 `tasks.md` 并更新已完成任务状态
