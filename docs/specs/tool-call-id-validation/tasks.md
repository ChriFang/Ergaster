# 畸形 tool_call 拦截与消息配对自愈实施计划

- [x] Task 1: 新建 tool-call-utils 纯函数模块
    - 1.1: 创建 `src/main/tool-call-utils.ts`，仅依赖 `../shared/agent` 与 `./deepseek-client` 的类型，不引入 electron
    - 1.2: 实现 `filterValidToolCalls`，返回 `{ valid, droppedReasons }`，校验 id 非空、name 非空、id 本次响应内唯一
    - 1.3: 在同一函数内判定「`arguments` 非空且 `JSON.parse` 失败」为无效，空 `arguments` 视为合法无参调用
    - 1.4: 输出的 valid 项统一 trim 过的 id 与 name，保留原始 `arguments` 字符串
    - 1.5: 丢弃原因只包含 index、id、工具名与原因描述，不含 `arguments` 全文

- [x] Task 2: 实现发送前配对自愈函数
    - 2.1: 在 `tool-call-utils.ts` 增加 `dropOrphanToolMessages`，返回 `{ messages, droppedToolCallIds }`
    - 2.2: 正向规则：`role=tool` 的 `tool_call_id` 必须在其前方最近的 assistant.tool_calls 集合内，否则丢弃；遇到其它非 tool 消息时清空集合
    - 2.3: 反向规则：assistant 的 tool_calls 中没有对应 tool 结果的项予以移除
    - 2.4: 若 assistant 移除后 tool_calls 为空且 content 为空，则整条消息丢弃
    - 2.5: 保证对正常历史零改动且函数幂等（不修改入参对象）

- [x] Task 3: 为两个纯函数补单元测试
    - 3.1: 新建 `src/main/tool-call-utils.test.ts`
    - 3.2: `filterValidToolCalls`：覆盖空 id、空 name、重复 id、非法 JSON arguments、空 arguments 合法、全部有效时原样通过
    - 3.3: `dropOrphanToolMessages`：覆盖正常配对零改动、孤儿 tool 消息被丢弃、assistant 多 tool_calls 只有部分结果、空 tool_calls 且空 content 的 assistant 被丢弃
    - 3.4: 覆盖幂等性（连续执行两次结果一致）与不修改入参
    - 3.5: 覆盖仅含 system/user/assistant 普通消息的历史为空操作
    - 3.6: 将测试文件加入 `package.json` 的 `test` 脚本 esbuild 入口与 `node --test` 参数，执行 `npm test` 通过

- [x] Task 4: 在 deepseek-client 接入新的有效性判定
    - 4.1: 删除 `src/main/deepseek-client.ts:198` 的本地 `filterValidToolCalls`，改为从 `tool-call-utils` 导入
    - 4.2: 更新流式分支（原 `:374` 附近）：使用 `valid`，并把 `droppedReasons` 逐条写入 ERROR 日志替换原来的数量日志
    - 4.3: 更新非流式分支（原 `:429` 附近）：同样接入并记录丢弃原因
    - 4.4: 确认 `hasOnlyInvalidToolCalls` 语义与非流式重试触发条件不变，`oneApiCompatibilityEnabled` 行为不变
    - 4.5: 确认全部无效且未开启兼容模式时，assistant 消息不带 tool_calls，本轮按普通回复正常结束

- [x] Task 5: 在请求构造处接入配对自愈
    - 5.1: 在 `buildRequestBody`（`deepseek-client.ts:126`）序列化前调用 `dropOrphanToolMessages`
    - 5.2: 有丢弃时写 WARN 日志（记录被丢弃的 tool_call_id 数量与列表）；注意 `buildRequestBody` 当前是同步函数，需按最小改动方式接入异步日志或把日志上移到调用处
    - 5.3: 确认 `attachments` 字段剥离逻辑与其余请求体字段不受影响

- [x] Task 6: 回归验证
    - 6.1: 执行 `npm test`，全部用例通过
    - 6.2: 执行 `npx tsc --noEmit -p tsconfig.node.json`，确认无新增错误（`agent-service.ts`、`conversation-service.ts`、`token-utils.ts` 中既有的 `ChatContentPart` 报错为改动前存量）
    - 6.3: 执行 `npm run build`，三端构建通过
    - 6.4: 用一段构造的畸形 tool_call 历史走一次 `buildRequestBody`，确认输出请求体中不再包含孤儿 `tool_result`；临时脚本验证后删除
