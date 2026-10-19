# Main 模块日志与工具调用日志实现总结

## 完成结果
- 在 Electron `userData` 目录下新增了 `log` 日志目录
- 将结构化审计日志迁移到了 `log/audit.log`
- 新增了 main 模块运行日志文件 `log/main.log`
- 在模型调用工具时，增加了工具名称与参数内容的 main 日志输出
- 在工具参数解析失败、参数校验失败、用户拒绝执行、执行开始、执行结束、执行失败等阶段补充了日志上下文
- 在 Agent 主流程中补充了请求开始、模型返回工具调用数量、成功结束、取消和失败日志

## 具体改动
### `e:\other-code\desktop-tools\src\main\audit-log.ts`
- 将日志根目录调整为：`path.join(app.getPath('userData'), 'log')`
- 新增：
  - `mainLogPath`
  - `appendMainLog()`
  - `getMainLogPath()`
- 保留现有 `sanitizeText()`，继续对 Bearer Token、`sk-` 风格密钥和本地路径做脱敏处理

### `e:\other-code\desktop-tools\src\main\tool-registry.ts`
- 在 `executeToolCall()` 中增加 main 日志：
  - 工具调用请求
  - 未知工具
  - JSON 解析失败
  - 参数校验失败
  - 用户拒绝执行
  - 工具执行开始
  - 工具执行完成
  - 工具执行失败
- 日志内容包含工具名称和参数内容
- 保持 `appendToolAuditLog()` 的原有结构化审计逻辑不变

### `e:\other-code\desktop-tools\src\main\agent-service.ts`
- 增加 main 运行日志：
  - Agent 请求开始
  - 每轮模型返回的工具调用数量
  - 无工具调用时的正常结束
  - 取消
  - 失败

## 验证结果
- `npm run typecheck` 通过
- `npm run build` 通过
- 日志目录与日志文件路径符合预期：
  - `userData/log/main.log`
  - `userData/log/audit.log`
- 工具调用日志经过现有脱敏逻辑处理，不会直接输出 Bearer Token、`sk-` 风格密钥或完整本地路径

## 结果说明
这次改动在不改变现有配置存储和工具执行主流程的前提下，补充了 main 模块运行日志与工具调用参数日志，便于后续排查模型调用、工具执行和主进程运行问题。
