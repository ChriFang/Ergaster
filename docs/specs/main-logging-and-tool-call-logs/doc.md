# Main 模块日志与工具调用日志增强

## 需求场景
当前项目已有审计日志能力，但日志文件直接写在 Electron `userData` 根目录下的 `audit.log`，没有独立的日志目录；同时缺少专门的 main 模块运行日志文件，也没有在模型触发工具调用时单独记录工具命令名和参数内容。

本次改动目标：
- 在 Electron `userData` 目录下新增 `log` 目录。
- main 模块日志统一写入 `main.log`。
- 在模型调用工具时，记录工具名称与参数内容，便于排查模型调用和工具执行问题。
- 保持现有审计日志脱敏逻辑，不影响现有配置存储和 Agent 主流程。

## 处理逻辑
1. main 进程初始化日志能力时，将日志根目录固定到：
   - `path.join(app.getPath('userData'), 'log')`
2. 在该目录下维护：
   - `main.log`：记录 main 模块运行日志
   - `audit.log`：保留现有结构化审计日志，但移动到 `log` 目录中
3. 在工具调用执行链路中，模型一旦返回 `tool_calls`，就记录：
   - 工具名称
   - 原始参数字符串
   - 可选：解析后的参数对象摘要
4. 当工具参数解析、校验、执行成功或失败时，继续保留现有 `appendToolAuditLog()` 结构化审计记录。
5. main 模块日志使用文本日志格式，便于直接查看；审计日志继续使用 JSON Lines，便于后续结构化分析。

## 技术方案
采用集中式日志模块方案：
- 扩展现有 `src/main/audit-log.ts`，使其同时负责：
  - 日志目录创建
  - `audit.log` 路径管理
  - `main.log` 路径管理
  - main 文本日志写入函数
- 在 `tool-registry.ts` 的工具调用入口增加 main 日志记录，打印模型调用的工具名和参数。
- 如有必要，在 `agent-service.ts` 中补充关键主流程日志，例如请求开始、模型返回工具调用数量等。

这种方案的优点：
- 不引入额外依赖，保持实现简单。
- 日志目录、文件路径和写入逻辑集中管理，避免分散重复。
- 兼容当前项目已有的审计日志体系。

## 影响范围
### 1. 日志模块
- 文件：`e:\other-code\desktop-tools\src\main\audit-log.ts`
- 修改类型：增强
- 影响函数：
  - `appendToolAuditLog()`
  - `appendAgentAuditLog()`
  - 新增 main 日志写入函数
  - 新增日志目录与 `main.log` 路径管理函数
- 计划改动：
  - 将 `audit.log` 从 `userData` 根目录迁移到 `userData/log/audit.log`
  - 新增 `main.log` 路径：`userData/log/main.log`
  - 新增诸如 `appendMainLog()` 的函数，用于写入 main 文本日志

### 2. 工具调用注册与执行链路
- 文件：`e:\other-code\desktop-tools\src\main\tool-registry.ts`
- 修改类型：日志增强
- 影响函数：
  - `executeToolCall()`
  - `getToolSummary()`（如需保留完整参数，可只用于审计摘要）
- 计划改动：
  - 在模型调用工具时打印工具命令名和参数
  - 记录原始参数字符串，避免因摘要截断导致排查信息不足
  - 在参数解析失败、校验失败或执行失败时，补充 main 日志上下文

### 3. Agent 主流程
- 文件：`e:\other-code\desktop-tools\src\main\agent-service.ts`
- 修改类型：可选增强
- 影响函数：
  - `run()`
- 计划改动：
  - 在模型返回 `tool_calls` 时记录本轮工具调用数量
  - 保持不输出 API Key 或敏感配置

## 实现细节
### 日志目录与文件路径
建议集中定义：
```ts
const logDirectory = path.join(app.getPath('userData'), 'log');
const auditLogPath = path.join(logDirectory, 'audit.log');
const mainLogPath = path.join(logDirectory, 'main.log');
```

### main 日志写入格式
建议使用简单文本格式：
```ts
[2026-05-15T10:20:30.000Z] [INFO] Tool call: open_application args={"appName":"notepad"}
```

示例函数：
```ts
export async function appendMainLog(level: 'INFO' | 'ERROR', message: string) {
  await fs.mkdir(logDirectory, { recursive: true });
  await fs.appendFile(mainLogPath, `[${new Date().toISOString()}] [${level}] ${sanitizeText(message)}\n`, 'utf8');
}
```

### 在工具调用处打印工具名和参数
建议在 `executeToolCall()` 一进入工具执行逻辑时增加：
```ts
await appendMainLog(
  'INFO',
  `Tool call: ${toolCall.function.name} args=${toolCall.function.arguments || '{}'}`,
);
```

如果参数解析失败，也记录：
```ts
await appendMainLog('ERROR', `Tool args parse failed: ${toolCall.function.name}`);
```

## 边界条件与异常处理
- 日志目录不存在时必须自动创建。
- 日志写入失败不应阻塞主业务流程，必要时吞掉日志异常或降级到 `console.warn`。
- 工具参数日志应经过现有 `sanitizeText()` 处理，避免把 API Key、Bearer Token 或敏感本地路径完整写入日志。
- 保持 `audit.log` 的结构化格式不变，避免破坏现有审计记录消费方式。
- `main.log` 仅记录 main 运行日志，不返回到 Renderer，不暴露给模型。

## 数据流
### 现状
模型返回 `tool_calls` → `agent-service.ts` 调用 `executeToolCall()` → `tool-registry.ts` 执行工具 → `appendToolAuditLog()` 写入 `audit.log`

### 改动后
模型返回 `tool_calls` → `agent-service.ts` / `tool-registry.ts` 记录 `main.log` → `tool-registry.ts` 执行工具 → `appendToolAuditLog()` 写入 `log/audit.log`

即：
- `main.log` 用于查看运行过程和工具调用细节
- `audit.log` 用于保留结构化审计结果

## 预期结果
- Electron `userData` 目录下会新增 `log` 目录。
- main 模块日志写入 `main.log`。
- 模型每次调用工具时，都会记录工具名称与参数。
- 现有审计日志仍保留，且迁移到 `log/audit.log`。
- 不影响配置文件读写、DeepSeek 调用逻辑与现有安全边界。
