# YY 用户信息查询工具实现任务计划

- [x] Task 1: 在 Main Process 中实现 YY 用户信息查询工具执行逻辑
    - 1.1: 在 `src/main/system-tools.ts` 中补充 YY 查询所需的 queryType 类型、随机 `_r` 生成逻辑和 80 位 `queryId` 生成逻辑
    - 1.2: 新增 `queryYyUserInfo(queryType, queryValue, signal?)`，按文档规则拼接查询 URL 并发起只读 GET 请求
    - 1.3: 解析接口返回，统一提取 `YY号`、`通行证`、`uid`、`昵称` 四个字段，并将其写入 `ToolResult.content` 与 `ToolResult.data`
    - 1.4: 处理空查询值、HTTP 错误、非 JSON 响应、`result=0`、缺少 `info`、字段缺失、超时和取消等异常场景

- [x] Task 2: 将 YY 用户信息查询工具注册到工具列表中供 LLM 调用
    - 2.1: 在 `src/main/tool-registry.ts` 中新增 `queryYyUserInfoSchema`，约束 `queryType` 只能为 1、2、3，`queryValue` 为非空字符串
    - 2.2: 在工具描述中明确映射规则：通行证=1、YY号=2、uid=3，不确定类型时默认按通行证处理并传 `queryType=1`
    - 2.3: 在 `registeredTools` 中新增 `query_yy_user_info` 工具项，并接入 `queryYyUserInfo(..., context.signal)` 执行入口
    - 2.4: 确保新工具继续使用 `strict: true` 和 `additionalProperties: false`，保持与现有工具注册规范一致

- [x] Task 3: 验证工具输出是否满足 LLM 总结要求
    - 3.1: 检查工具成功返回内容是否只聚焦 `YY号`、`通行证`、`uid`、`昵称` 四个关键字段，降低模型总结偏移
    - 3.2: 运行类型检查或构建验证新增工具未破坏现有 Main Process 工具链路
    - 3.3: 如有必要，微调工具 description 或返回字段命名，确保用户发送“查询YY用户信息，通行证/YY号/uid ...”时模型更稳定地调用正确工具并输出目标字段
