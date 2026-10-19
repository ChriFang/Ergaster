# tool-call-id-validation：畸形 tool_call 的拦截与消息配对自愈

## 1. 问题场景

用户在配置好 HTTP（Streamable HTTP）MCP 服务后发起对话，第二轮请求被模型网关拒绝：

```
ChatCompletionRequestError: The request is invalid: unexpected `***.***.content.0: tool_use_id`
found in `tool_result` blocks: call_00_71ybudemX0M6o1ig7Pdh3970.
Each `tool_result` block must have a corresponding `tool_use` block in the previous message.
```

主进程日志（`~/Library/Application Support/Desktop Agent/log/main.log`）显示的完整链路：

```
[INFO]  [mcp] Connected server 鸿蒙开发知识 (streamable-http https://connect-api.cloud.huawei.com/api/developerknowledge/mcp) with 2 tools
[INFO]  Agent request started: 如何创建一个鸿蒙app？
[ERROR] Ignored invalid tool calls count=1
[INFO]  Model stream finished contentLength=29 reasoningLength=240 toolCalls=2
[INFO]  Model response round=1 toolCalls=2
[INFO]  Tool call requested: mcp_0_1 args={"SearchDocumentsReq">
        <｜｜DSML｜｜parameter: "创建HarmonyOS应用"}
[ERROR] Tool arguments JSON parse failed: mcp_0_1
[INFO]  Tool call requested: mcp_0_1 args={"SearchDocumentsReq">
        <｜｜DSML｜｜parameter: "创建鸿蒙应用 工程"}
[ERROR] Tool arguments JSON parse failed: mcp_0_1
[ERROR] Agent request failed: The request is invalid ...
```

结论：HTTP MCP 传输本身正常（连接成功、拿到 2 个工具）。故障源于上游把 DeepSeek 的原生函数调用格式解析坏了——`arguments` 里漏出了 `<｜｜DSML｜｜parameter` 内部标记，说明该链路是「提示词式工具调用 + 文本解析」，遇到 MCP 工具的嵌套对象入参（`SearchDocumentsReq`）时解析失败。

## 2. 根因分析

坏数据进入我们的历史消息，分三步：

1. 流式合并（`/Users/fangruibin/Work/other-code/desktop-tools/src/main/deepseek-client.ts:173` `mergeToolCallDelta`）按 index 归并 delta，把断裂的文本拼成了 3 个 tool_call。
2. `filterValidToolCalls`（同文件 `:198`）只校验 `function.name`：

   ```ts
   function filterValidToolCalls(toolCalls: ToolCall[]) {
     return toolCalls.filter((toolCall) => toolCall.function.name.trim());
   }
   ```

   `id` 为空串、`id` 重复、`arguments` 非法 JSON 都能通过。日志里被丢掉的那 1 个是 name 为空的，而保留的 2 个中至少 1 个 `id` 为空。
3. `agent-service.ts:428` 把该 assistant 消息（含空 id 的 tool_calls）压入历史，`:467` 无条件为每个 tool_call 追加 `role=tool` 消息（参数解析失败也会追加一条 error 结果，见 `tool-registry.ts:786-791`）。第二轮请求发出后，网关在转 Claude 格式时判定这条 assistant 消息非法，`tool_use` 块丢失，后续 `tool_result` 全部变成孤儿 → 400。

`agent-service.ts:462` 的 `seenToolCalls` 只在**跨轮/本轮重复 id** 时抛错，不覆盖空 id 场景。

## 3. 技术方案

在我们可控的两处加固，让畸形数据不出门；同时补一道发送前的配对自愈，兜住未来任何类似的错乱。

### 3.1 收紧 tool_call 有效性判定

把校验从「name 非空」扩展为「id 非空 + name 非空 + id 在本次响应内唯一」，并抽成可单测的纯函数放到 `src/main/tool-call-utils.ts`（新文件，不依赖 electron）：

```ts
export type ToolCallFilterResult = {
  valid: ToolCall[];
  droppedReasons: string[];
};

export function filterValidToolCalls(toolCalls: ToolCall[]): ToolCallFilterResult {
  const valid: ToolCall[] = [];
  const droppedReasons: string[] = [];
  const seenIds = new Set<string>();

  for (const [index, toolCall] of toolCalls.entries()) {
    const id = toolCall.id?.trim() ?? '';
    const name = toolCall.function.name.trim();

    if (!id) {
      droppedReasons.push(`index=${index} 缺少 tool_call id`);
      continue;
    }
    if (!name) {
      droppedReasons.push(`id=${id} 缺少工具名`);
      continue;
    }
    if (seenIds.has(id)) {
      droppedReasons.push(`id=${id} 重复`);
      continue;
    }

    seenIds.add(id);
    valid.push({ ...toolCall, id, function: { name, arguments: toolCall.function.arguments } });
  }

  return { valid, droppedReasons };
}
```

`deepseek-client.ts` 的流式（`:374`）与非流式（`:429`）两处改为调用它，并把 `droppedReasons` 写进日志，替换现在只有数量的 `Ignored invalid tool calls count=N`。

行为影响：本次故障中 3 个 tool_call 会全部或大部分被判为无效。若全部无效，走已有的 `hasOnlyInvalidToolCalls` → 非流式重试分支（`:375`，受 `oneApiCompatibilityEnabled` 控制）；重试仍无效时 assistant 消息不带 tool_calls，本轮按普通回复结束（本次响应有 29 字符正文），比发出 400 请求更可用。此处不改动 `oneApiCompatibilityEnabled` 的语义。

### 3.2 参数非法 JSON 不再生成工具结果

`arguments` 解析失败说明这条 tool_call 本身是坏数据。当前 `executeDefinedToolCall` 会返回一条 error tool 消息（`tool-registry.ts:786-791`），等于用一个可能不可信的 id 往历史里追加 `tool_result`。

调整为：在 `deepseek-client` 层面就把「`arguments` 非空且无法 `JSON.parse`」的 tool_call 判为无效（并入 3.1 的过滤），这样它不会进入 assistant 消息，也不会产生对应的 tool 结果。`tool-registry.ts` 中原有的 JSON 兜底保留——它仍是执行期的最后防线（例如 skill 调用路径），不做删除。

### 3.3 发送前的配对自愈

在 `buildRequestBody`（`deepseek-client.ts:126`）序列化之前，插入一次配对校验，纯函数同样放在 `src/main/tool-call-utils.ts`：

```ts
// role=tool 的消息必须能在其前方最近的 assistant.tool_calls 中找到对应 id，否则丢弃。
export function dropOrphanToolMessages(messages: ChatCompletionApiMessage[]): {
  messages: ChatCompletionApiMessage[];
  droppedToolCallIds: string[];
};
```

规则：

- 顺序扫描，遇到 `role=assistant` 且带 `tool_calls` 时，把其 id 集合作为当前可用集合；
- 遇到 `role=tool`，`tool_call_id` 在当前集合内则保留，否则丢弃并记录；
- 遇到其它非 tool 消息则清空当前集合（`tool_result` 必须紧随对应的 `tool_use`）;
- 反向也校验：assistant 的 tool_calls 若在其后没有任何对应 tool 结果，则移除该 tool_calls 项；若移除后 tool_calls 为空且 `content` 也为空，则丢弃整条 assistant 消息（避免出现「空 tool_use」这类会被网关判非法的消息）。

被丢弃的内容写 WARN 日志，便于后续定位是哪条链路产生的错乱。

### 3.4 数据流

```text
模型流式响应
  -> mergeToolCallDelta 归并 delta
  -> filterValidToolCalls（id/name/唯一性/arguments 可解析）
  -> 全部无效且开启兼容模式 ? 非流式重试 : 返回不带 tool_calls 的 assistant 消息
  -> agent-service 压入 assistant 消息，并为每个有效 tool_call 追加 tool 结果
  -> 下一轮 buildRequestBody
  -> dropOrphanToolMessages 配对自愈
  -> 发送
```

## 4. 影响文件

- `/Users/fangruibin/Work/other-code/desktop-tools/src/main/tool-call-utils.ts`（新增）：`filterValidToolCalls`、`dropOrphanToolMessages`。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/main/tool-call-utils.test.ts`（新增）：两个函数的单测。
- `/Users/fangruibin/Work/other-code/desktop-tools/src/main/deepseek-client.ts`：删除本地 `filterValidToolCalls`（`:198`），改用新模块；流式 `:374` 与非流式 `:429` 两处接入并记录丢弃原因；`buildRequestBody`（`:126`）接入 `dropOrphanToolMessages`。
- `/Users/fangruibin/Work/other-code/desktop-tools/package.json`：测试脚本接入新测试文件。

不改动：`agent-service.ts` 的循环结构与 `seenToolCalls` 逻辑、`tool-registry.ts` 的执行期兜底、MCP 相关代码。

## 5. 边界与异常

- `arguments` 为空字符串是合法情况（无参工具），不能判为无效；只有「非空且 `JSON.parse` 失败」才判无效。
- `dropOrphanToolMessages` 是幂等的纯函数，对正常历史必须零改动——这一点要有测试覆盖，避免修复引入回归。
- 摘要压缩后的历史里本就不含 tool 消息（`conversation-service.ts` 的 `filterMessagesForPersistence` 会过滤掉 tool 与带 tool_calls 的 assistant），配对自愈对它是空操作。
- 日志中不打印 `arguments` 全文（可能含用户数据），只记录 id、工具名和丢弃原因。
- 本方案不能让上游那条链路正确调用嵌套入参的 MCP 工具——它的 tool_call 解析本身是坏的。我们能保证的是：不再发出畸形请求、不再把会话卡死，并给出可读的失败原因。

## 6. 预期结果

- 遇到上游输出的畸形 tool_call 时，客户端不再发出会被拒的请求，而是丢弃坏数据、记录原因，并在可能时用非流式重试补救。
- 即使历史中出现 assistant/tool 配对错乱，发送前也会被自愈，不再出现 `tool_result ... must have a corresponding tool_use` 这类 400。
- 正常的工具调用链路行为完全不变，由单测保证。
