# YY 用户信息查询工具设计

## 需求场景
用户希望在桌面 Agent 中新增一个可被 LLM 调用的工具，用于根据自然语言中的标识信息查询 YY 用户资料。

目标输入场景包括：
- `查询YY用户信息，通行证xxx`
- `查询YY用户信息，YY号xxx`
- `查询YY用户信息，uid xxx`
- 未明确说明类型，只提供一个值时，默认按通行证处理

目标输出要求包括：
- 工具根据用户输入选择正确的查询类型并调用 YY 查询接口
- 工具拿到接口返回后，把结构化结果提供给 LLM
- LLM 最终回复中必须包含：`YY号`、`通行证`、`uid`、`昵称`

## 已知上下文
- 仓库根目录：`e:\other-code\desktop-tools`
- 当前工具体系为 Electron Main Process 内本地函数注册，不是 MCP 服务。
- LLM 可调用工具注册入口：`e:\other-code\desktop-tools\src\main\tool-registry.ts`
- 工具执行实现文件：`e:\other-code\desktop-tools\src\main\system-tools.ts`
- Agent 多轮工具调用循环：`e:\other-code\desktop-tools\src\main\agent-service.ts`
- 工具类型定义：`e:\other-code\desktop-tools\src\shared\tools.ts`
- YY 查询接口说明文档：`e:\other-code\desktop-tools\doc\yy-info-spec.md`

## 查询协议与映射规则
根据 `e:\other-code\desktop-tools\doc\yy-info-spec.md`，查询接口为：

```text
https://webdb.yyembed.yy.com/webdb/query_userinfo?type={queryType}&value={queryValue}&_r={rValue}&queryId={queryId}
```

查询类型映射：
- `1`：通行证
- `2`：YY号
- `3`：uid

本次实现要求工具直接接收结构化参数，不在工具内部解析整句自然语言。自然语言到结构化参数的映射由 LLM 完成，工具 schema 负责把映射规则明确暴露给模型：
- 当用户表达“通行证 xxx”时，LLM 应调用工具并传 `queryType: 1`、`queryValue: xxx`
- 当用户表达“YY号 xxx”时，LLM 应调用工具并传 `queryType: 2`、`queryValue: xxx`
- 当用户表达“uid xxx”时，LLM 应调用工具并传 `queryType: 3`、`queryValue: xxx`
- 当用户只给出一个值、类型不明确时，LLM 应默认传 `queryType: 1`、`queryValue: xxx`

这样可以保持现有工具框架一致：工具只处理严格 schema 参数，语义判断交给模型，但通过 description 和 schema 描述把规则固化下来。

## 总体技术方案
新增一个低风险只读工具 `query_yy_user_info`，由 Main Process 直接发起 HTTPS 请求，返回结构化 ToolResult。

实现分为两部分：
1. 在 `system-tools.ts` 中新增 YY 查询执行函数，负责：
    - 生成 `_r` 参数
    - 生成 `queryId` 参数
    - 拼接接口 URL
    - 使用 `fetch` 发起 GET 请求
    - 解析 JSON 响应
    - 归一化提取 `YY号`、`passport`、`uid`、`nick`
    - 返回适合 LLM 总结的 `content` 和结构化 `data`
2. 在 `tool-registry.ts` 中新增工具注册项，负责：
    - 定义 Zod 参数校验
    - 定义 JSON Schema
    - 明确在工具描述中写出 queryType 与自然语言的映射规则
    - 将该工具加入已注册工具列表，供 DeepSeek tool calls 使用

## 数据流路径

```text
用户输入自然语言
  -> AgentService 发送 messages + tools 给模型
  -> 模型根据工具描述判断 queryType / queryValue
  -> 模型发起 query_yy_user_info tool_call
  -> tool-registry.ts 解析并校验参数
  -> system-tools.ts 调用 YY 查询接口
  -> 工具返回结构化结果（含 YY号、通行证、uid、昵称）
  -> AgentService 将 tool message 回填给模型
  -> 模型输出最终中文总结
```

## 工具设计

### 工具名
`query_yy_user_info`

### 风险级别
`low`

理由：
- 只执行外部只读查询
- 不修改本地文件、不执行命令、不访问受限路径
- 不包含高危系统操作

### 参数设计
建议参数如下：

```ts
{
  queryType: 1 | 2 | 3;
  queryValue: string;
}
```

说明：
- `queryType`：查询类型，1=通行证，2=YY号，3=uid
- `queryValue`：实际查询值

Zod 校验规则：
- `queryType` 必须为 `1`、`2` 或 `3`
- `queryValue` 必须为非空字符串
- 建议限制长度，例如 `1..100`
- `additionalProperties: false`

## 接口调用细节

### URL 构造
基于文档构造 URL：

```ts
const url = new URL('https://webdb.yyembed.yy.com/webdb/query_userinfo');
url.searchParams.set('type', String(queryType));
url.searchParams.set('value', queryValue);
url.searchParams.set('_r', randomRValue);
url.searchParams.set('queryId', queryId);
```

### `_r` 生成规则
文档要求：
- 取值范围 0 到 1
- 小数点后长度 17 位

实现方式：

```ts
const randomRValue = Math.random().toFixed(17);
```

该值会得到如 `0.12345678901234567` 的格式，满足当前文档约束。

### `queryId` 生成规则
文档要求：
- 包含大小写字符、数字、`-`、`_`
- 长度 80

实现方式：
- 维护允许字符集
- 随机采样 80 次拼接

```ts
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let queryId = '';
for (let i = 0; i < 80; i += 1) {
  queryId += chars[Math.floor(Math.random() * chars.length)];
}
```

## 响应处理逻辑

### 成功响应
当接口返回：

```json
{ "result": 1, "info": { ... } }
```

处理逻辑：
- 从 `info['YY号']` 或 `info.yyno` 读取 YY号
- 从 `info.passport` 读取通行证
- 从 `info.uid` 读取 uid
- 从 `info.nick` 读取昵称
- 返回统一结构

建议工具返回数据：

```ts
return {
  ok: true,
  content: JSON.stringify({
    yyno,
    passport,
    uid,
    nick,
  }, null, 2),
  data: {
    queryType,
    queryValue,
    yyno,
    passport,
    uid,
    nick,
    raw: payload,
  },
};
```

其中 `content` 只保留 LLM 最终总结必需字段，避免模型被无关字段干扰。

### 失败响应
当接口返回：

```json
{ "result": 0, "info": "错误信息" }
```

处理逻辑：
- 返回 `ok: false`
- `error` 使用接口返回的错误信息
- `content` 置空
- `data` 可包含查询参数和原始返回，便于调试

### 非法响应
需要处理以下异常：
- 网络请求失败
- HTTP 非 2xx
- 返回体不是合法 JSON
- JSON 中缺少 `result`
- `result = 1` 但缺少 `info`
- `info` 结构异常，缺少核心字段

处理原则：
- 尽量返回结构化错误消息
- 不吞掉原始错误语义
- 保持与当前 ToolResult 风格一致

## 对 LLM 的约束方式
当前框架不会在工具执行后自动做字段级强制总结，因此需要从两个层面约束模型：

1. 工具描述中明确写出调用规则
    - 通行证 -> `queryType=1`
    - YY号 -> `queryType=2`
    - uid -> `queryType=3`
    - 不确定时默认 `queryType=1`
2. 工具返回 `content` 中只提供最终所需四个字段
    - `YY号`
    - `通行证`
    - `uid`
    - `昵称`

这样模型在生成最终回复时，会优先围绕这四个字段作答。

## 受影响文件

### 1. `e:\other-code\desktop-tools\src\main\system-tools.ts`
修改类型：扩展现有工具实现文件

预计新增内容：
- 查询类型常量或类型定义
- `_r` 生成函数
- `queryId` 生成函数
- `query_yy_user_info` 的执行函数
- 响应解析与错误处理逻辑

受影响函数：
- 新增 `queryYyUserInfo(queryType, queryValue, signal?)`
- 可能新增 `buildYyQueryId()`、`buildYyRandomValue()` 等局部辅助函数

### 2. `e:\other-code\desktop-tools\src\main\tool-registry.ts`
修改类型：扩展工具 schema 与注册表

预计新增内容：
- `queryYyUserInfoSchema`
- `registeredTools` 中新增 `query_yy_user_info`
- 顶部导入 `queryYyUserInfo`

受影响位置：
- import 区域
- schema 定义区域
- `registeredTools` 数组

### 3. `e:\other-code\desktop-tools\.comate\specs\yy-user-info-tool\tasks.md`
修改类型：后续新增任务拆解文档

### 4. `e:\other-code\desktop-tools\.comate\specs\yy-user-info-tool\summary.md`
修改类型：实现完成后新增总结文档

## 关键实现片段

### system-tools.ts 中的工具实现示意

```ts
export async function queryYyUserInfo(
  queryType: 1 | 2 | 3,
  queryValue: string,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const trimmedValue = queryValue.trim();

  if (!trimmedValue) {
    return {
      ok: false,
      content: '',
      error: '查询值不能为空。',
    };
  }

  const url = new URL('https://webdb.yyembed.yy.com/webdb/query_userinfo');
  url.searchParams.set('type', String(queryType));
  url.searchParams.set('value', trimmedValue);
  url.searchParams.set('_r', buildYyRandomValue());
  url.searchParams.set('queryId', buildYyQueryId());

  const response = await fetch(url, {
    method: 'GET',
    signal,
    headers: {
      accept: 'application/json, text/plain, */*',
    },
  });

  if (!response.ok) {
    return {
      ok: false,
      content: '',
      error: `YY 用户信息查询失败，HTTP 状态码 ${response.status}`,
    };
  }

  const payload = await response.json();

  if (payload?.result !== 1) {
    return {
      ok: false,
      content: '',
      error: typeof payload?.info === 'string' ? payload.info : 'YY 用户信息查询失败。',
      data: payload,
    };
  }

  const info = payload.info ?? {};
  const yyno = String(info['YY号'] ?? info.yyno ?? '');
  const passport = String(info.passport ?? '');
  const uid = String(info.uid ?? '');
  const nick = String(info.nick ?? '');

  return {
    ok: true,
    content: JSON.stringify({
      YY号: yyno,
      通行证: passport,
      uid,
      昵称: nick,
    }, null, 2),
    data: {
      queryType,
      queryValue: trimmedValue,
      YY号: yyno,
      通行证: passport,
      uid,
      昵称: nick,
      raw: payload,
    },
  };
}
```

### tool-registry.ts 中的注册示意

```ts
const queryYyUserInfoSchema = z.object({
  queryType: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  queryValue: z.string().min(1).max(100),
});
```

```ts
{
  name: 'query_yy_user_info',
  description:
    '查询 YY 用户信息。queryType: 1=通行证，2=YY号，3=uid；当用户没有明确说明类型时，默认按通行证处理并传 1。返回结果会包含 YY号、通行证、uid 和昵称。',
  risk: 'low',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      queryType: {
        type: 'integer',
        enum: [1, 2, 3],
        description: '查询类型：1=通行证，2=YY号，3=uid；不确定时默认传 1',
      },
      queryValue: {
        type: 'string',
        description: '待查询的实际值，例如通行证、YY号或 uid',
      },
    },
    required: ['queryType', 'queryValue'],
    additionalProperties: false,
  },
  validator: queryYyUserInfoSchema,
  execute: async (args, context) => {
    const input = args as z.infer<typeof queryYyUserInfoSchema>;
    return queryYyUserInfo(input.queryType, input.queryValue, context.signal);
  },
}
```

## 边界条件与异常处理
- 用户提供空字符串：本地参数校验失败或工具返回“查询值不能为空”
- 用户把数字型 YY号 / uid 当成字符串传入：允许，接口本身按字符串 query 参数处理
- 用户未指定类型：由工具 description 引导模型默认传 `queryType=1`
- 用户输入中带多余空格：工具内部 `trim()`
- 接口返回成功但字段为空：仍返回成功，但字段值为空字符串，由模型如实总结
- 接口不可达、超时或被取消：返回错误，沿用当前工具执行异常通道
- 接口返回中文键 `YY号` 与英文键 `yyno` 并存：优先读 `YY号`，无则回退 `yyno`

## 预期结果
完成后，LLM 将可以在收到类似以下请求时触发工具：
- `查询YY用户信息，通行证 fangruibin01`
- `查询YY用户信息，YY号 2396025464`
- `查询YY用户信息，uid 2394259416`
- `查询YY用户信息，fangruibin01`

并在工具返回后生成类似结果：

```text
查询结果如下：
- YY号：2396025464
- 通行证：fangruibin01
- uid：2394259416
- 昵称：bin01
```

## 实现取舍说明
本次不新增单独的自然语言解析模块，不在 Main Process 中自行解析“通行证/YY号/uid”中文文本。

原因：
- 当前仓库工具体系已经采用“LLM 负责意图识别 + 工具负责严格执行”的模式
- 若再在本地实现一层自然语言解析，会与模型工具调用职责重叠
- 通过完善 tool description 与返回内容，已经足以满足本需求，并且改动更小、更符合现有架构
