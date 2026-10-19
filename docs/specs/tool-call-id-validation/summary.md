# 畸形 tool_call 拦截与消息配对自愈总结

## 修复的问题

HTTP MCP 工具调用时报 400：`tool_result ... must have a corresponding tool_use block in the previous message`。

根因不在 MCP 传输，而在上游网关把 DeepSeek 的函数调用格式解析坏了（`arguments` 混入 `<｜｜DSML｜｜parameter` 内部标记，且部分 tool_call 缺 id），而客户端原来的 `filterValidToolCalls` 只校验 `function.name`，把这些坏数据原样发了出去，导致 assistant 消息在网关侧被判非法、后续 tool_result 变成孤儿。

## 改动清单

新增：

- `src/main/tool-call-utils.ts`
  - `filterValidToolCalls(toolCalls)`：返回 `{ valid, droppedReasons }`。要求 id 非空、工具名非空、id 本次响应内唯一、`arguments` 为空或可 `JSON.parse`。id 与工具名统一 trim，`arguments` 原样透传。
  - `dropOrphanToolMessages(messages)`：发送前配对自愈。丢弃 `tool_call_id` 找不到紧邻 assistant `tool_calls` 的 tool 消息；移除没有结果的 `tool_calls` 项；若 assistant 的 tool_calls 全部无结果且正文为空则整条丢弃。纯函数、幂等、不修改入参。
- `src/main/tool-call-utils.test.ts`：11 个用例。

修改：

- `src/main/deepseek-client.ts`
  - 删除原本地 `filterValidToolCalls`，流式与非流式两处改用新模块，并把每条丢弃原因写入 ERROR 日志（原来只有数量）。
  - `requestChatCompletion` 在构造请求体前调用 `dropOrphanToolMessages`，有丢弃时写 WARN 日志。`hasOnlyInvalidToolCalls` → 非流式重试的触发条件与 `oneApiCompatibilityEnabled` 语义均未改动。
- `package.json`：测试脚本接入新测试文件。

未改动：`agent-service.ts` 的工具循环与 `seenToolCalls`、`tool-registry.ts` 的执行期 JSON 兜底（仍是最后防线）、MCP 相关代码。

## 行为变化

- 本次故障场景下 3 个 tool_call 全部被判无效（1 个参数非法 JSON、1 个缺 id、1 个缺工具名）。开启 `oneApiCompatibilityEnabled` 时走已有的非流式重试；否则 assistant 消息不带 tool_calls，本轮按普通回复结束，而不是发出必然被拒的请求。
- 日志从 `Ignored invalid tool calls count=1` 变为逐条原因，例如 `Ignored invalid streamed tool call: id=call_00_71yb... tool=mcp_0_1 参数不是合法 JSON`。日志不回显 `arguments` 全文。

## 验证

- `npm test`：63 个用例全部通过（新增 11 个）。
- `npx tsc --noEmit -p tsconfig.node.json`：无新增错误；`agent-service.ts`、`conversation-service.ts`、`token-utils.ts` 中关于 `ChatContentPart` 的报错为改动前存量。
- `npm run build`：三端构建通过。
- 用日志中的真实畸形数据做过一次脚本级验证：3 个 tool_call 全部被拦下并给出可读原因；含孤儿 tool 消息的历史经自愈后不再残留任何 `tool_result`。临时脚本已删除。

## 补充修复：稀疏数组空洞导致的 TypeError

首次联调时报 `TypeError: Cannot read properties of undefined (reading 'id')`，日志显示错误发生在任何工具调用日志之前，即在 `filterValidToolCalls` 内。

原因：`mergeToolCallDelta` 按 `delta.index` 直接下标赋值（`deepseek-client.ts:185`），上游 delta 的 index 不连续时归并结果是**稀疏数组**（前面留空洞）。旧实现用 `Array.prototype.filter`，天然跳过空洞；新实现用 `for...of toolCalls.entries()`，空洞会作为 `undefined` 参与迭代，于是读 `.id` 抛错。

修复：`filterValidToolCalls` 显式跳过 `!toolCall?.function` 的项并记为「tool_call 结构不完整」；`type` 缺失时兜底为 `'function'`；`dropOrphanToolMessages` 中对 `tool_calls` 元素同样做空值保护。新增 2 个用例覆盖稀疏数组与缺 `function` 字段，共 65 个用例通过，构建通过。`mergeToolCallDelta` 的下标语义未改动——空洞代表上游确实没发那一路 delta，改成追加会导致后续 delta 错位合并。

## 遗留

上游那条链路对嵌套入参（如华为 MCP 的 `SearchDocumentsReq`）的工具调用解析本身是坏的，本次修复只能保证客户端不再发出畸形请求、不再把会话卡死，并给出可定位的失败原因。要真正调通该 MCP 工具，需要换用原生支持 function calling 的端点，或开启 `oneApiCompatibilityEnabled` 走非流式路径再验证。
