# 基础联网查询工具实现总结

## 完成内容
已完成一个新的 LLM 可调用工具 `http_request`，用于执行最基础的 HTTP/HTTPS GET 联网请求，并接入现有 Electron Main Process 工具体系。

本次交付包含以下改动：
- 在 `src/main/system-tools.ts` 中新增通用 HTTP 请求执行函数
- 在 `src/main/tool-registry.ts` 中注册 `http_request` 工具
- 在 `src/main/audit-log.ts` 中补强敏感 header / 凭证日志脱敏规则
- 更新 `.comate/specs/basic-web-request-tool/tasks.md` 任务状态为全部完成

## 实现结果

### 1. 新增基础联网请求工具
实现位置：`e:\other-code\desktop-tools\src\main\system-tools.ts:386`

新增能力包括：
- 校验 URL 合法性
- 仅允许 `http:` / `https:` 协议
- 支持可选 `query` 参数合并到 URL
- 支持可选 `headers` 请求头输入
- 自动过滤不应手工设置的请求头，如 `host`、`content-length`
- 使用 `fetch` 执行 `GET` 请求
- 兼容取消信号，取消时统一返回“工具执行已取消”
- 读取响应文本并截断到预设上限
- 返回状态码、内容类型、请求头摘要、响应头摘要和正文预览

相关辅助逻辑位置：
- 文本截断：`e:\other-code\desktop-tools\src\main\system-tools.ts:75`
- 请求头规范化：`e:\other-code\desktop-tools\src\main\system-tools.ts:97`
- 请求头摘要脱敏：`e:\other-code\desktop-tools\src\main\system-tools.ts:139`
- 响应内容拼装：`e:\other-code\desktop-tools\src\main\system-tools.ts:149`

### 2. 注册到工具列表供 LLM 使用
注册位置：`e:\other-code\desktop-tools\src\main\tool-registry.ts:196`

本次新增：
- `httpRequestSchema`：`e:\other-code\desktop-tools\src\main\tool-registry.ts:50`
- `http_request` 工具定义：`e:\other-code\desktop-tools\src\main\tool-registry.ts:196`

工具特性：
- 工具名：`http_request`
- 风险级别：`medium`
- 仅暴露只读 GET 查询语义
- 参数支持：`url`、`query`、`headers`
- 自动纳入现有 `registeredTools` 输出链路，供模型自行决定何时调用

### 3. 增强日志脱敏
修改位置：`e:\other-code\desktop-tools\src\main\audit-log.ts:10`

新增脱敏覆盖：
- `authorization`
- `proxy-authorization`
- `cookie`
- `set-cookie`
- `x-api-key`
- 现有 Bearer token 与 `sk-*` 模式继续保留

这样即使联网工具带了敏感 header，也不会把原值直接写入主日志或审计日志。

## 验证结果

### 构建验证
已执行：`npm run build`

结果：通过。

### Lint 验证
已检查以下文件：
- `e:/other-code/desktop-tools/src/main/system-tools.ts`
- `e:/other-code/desktop-tools/src/main/tool-registry.ts`
- `e:/other-code/desktop-tools/src/main/audit-log.ts`

结果：未发现 lints。

## 最终行为
完成后，LLM 现在可以在对话中自行决定：
- 是否需要联网
- 访问哪个公开 HTTP/HTTPS 地址
- 是否附带基础 query 参数
- 是否附带基础 headers
- 如何根据返回的文本内容继续作答

工具本身只负责最基本的网络请求，不负责搜索策略、资料来源选择或调用时机判断，这些决策仍由模型完成。

## 说明
当前实现按设计收敛为“基础只读联网查询”：
- 支持 `http/https`
- 仅支持 `GET`
- 不支持交互式网页操作
- 不支持写操作请求
- 不支持文件下载与保存

这与当前需求保持一致，同时复用了现有工具确认、超时控制和日志审计机制。