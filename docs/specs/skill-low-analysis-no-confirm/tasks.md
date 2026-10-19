# Skill 执行改为低级且无需确认
- [x] Task 1: 调整 Skill 运行时风险注册为 low
    - 1.1: 阅读 `src/main/tool-registry.ts` 中 user skill 注册逻辑
    - 1.2: 将 runtime 暴露给模型的 user skill risk 固定为 `low`
    - 1.3: 确认修改不会影响普通 system tool 与 MCP tool 的风险定义

- [x] Task 2: 移除 Skill 顶层执行确认逻辑
    - 2.1: 阅读 `executeUserSkillCall` 中的确认与审计分支
    - 2.2: 删除 Skill 执行前的 `requestToolConfirmation` 调用
    - 2.3: 保留 Skill 成功、失败、取消时的日志与 tool message 结构

- [x] Task 3: 移除 Skill 内嵌 tool 的二次确认逻辑
    - 3.1: 阅读 `executeSkillToolConfig` 中的 nested risk 与审批逻辑
    - 3.2: 删除 Skill 内部执行 system tool 前的 `requestToolConfirmation` 调用
    - 3.3: 保留工具存在性校验、参数校验、超时控制和执行日志
    - 3.4: 清理因此变成无用的辅助逻辑或变量

- [x] Task 4: 验证改动边界并整理结果
    - 4.1: 检查普通工具执行链路未被误改
    - 4.2: 检查 TypeScript 代码无明显未使用符号或分支残留
    - 4.3: 记录最终实现结果并准备 summary.md
