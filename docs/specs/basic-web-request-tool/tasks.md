# 基础联网查询工具任务拆解
- [x] Task 1: 实现通用 HTTP/HTTPS 请求执行能力
    - 1.1: 在 `src/main/system-tools.ts` 中新增 `http_request` 所需的参数类型与辅助函数
    - 1.2: 实现 URL 校验、协议限制、query 合并与请求头规范化逻辑
    - 1.3: 实现基于 `fetch` 的 GET 请求、取消处理、响应读取与正文截断逻辑
    - 1.4: 返回统一的 `ToolResult`，包含状态码、内容类型、响应头摘要与正文预览

- [x] Task 2: 将 HTTP 请求工具注册到 LLM 工具列表
    - 2.1: 在 `src/main/tool-registry.ts` 中新增 `httpRequestSchema`
    - 2.2: 为 `http_request` 定义 JSON Schema、工具描述和 `medium` 风险级别
    - 2.3: 接入 `registeredTools`，并将执行函数绑定到 `system-tools.ts` 中的新实现

- [x] Task 3: 补强日志脱敏以覆盖联网请求场景
    - 3.1: 审查 `src/main/audit-log.ts` 的现有脱敏规则
    - 3.2: 增加对常见敏感请求头或凭证样式的脱敏处理
    - 3.3: 确保联网工具的日志与审计输出不会直接泄露敏感 header 值

- [x] Task 4: 验证实现并整理交付结果
    - 4.1: 检查新增工具与现有类型定义、执行链路是否一致
    - 4.2: 运行必要的构建或校验命令并修复相关问题
    - 4.3: 完成任务状态更新，并为后续总结文档整理结果
