# Main 模块日志与工具调用日志任务计划
- [x] Task 1: 增强日志目录与日志文件管理
    - 1.1: 在 `src/main/audit-log.ts` 中将日志根目录调整为 Electron `userData/log`
    - 1.2: 将结构化审计日志路径迁移为 `log/audit.log`
    - 1.3: 新增 `main.log` 路径与 main 文本日志写入函数
    - 1.4: 确保日志目录不存在时自动创建，且日志写入失败不阻塞主流程

- [x] Task 2: 在工具调用链路中增加命令名与参数日志
    - 2.1: 在 `src/main/tool-registry.ts` 中记录模型调用的工具名称
    - 2.2: 在 `src/main/tool-registry.ts` 中记录模型传入的原始参数字符串
    - 2.3: 在参数解析失败、校验失败和执行失败时补充 main 日志上下文
    - 2.4: 保持现有审计日志记录逻辑不变，仅补充 main 运行日志

- [x] Task 3: 验证日志增强不影响现有主流程
    - 3.1: 验证日志目录与 `main.log`、`audit.log` 路径符合预期
    - 3.2: 验证工具调用日志不输出 API Key、Bearer Token 或未脱敏敏感路径
    - 3.3: 运行类型检查，确认日志模块和工具调用链路改动不破坏现有工程
