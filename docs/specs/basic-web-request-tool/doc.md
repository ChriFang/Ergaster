# 基础联网查询工具设计

## 需求场景
用户希望在当前桌面 Agent 中新增一个可供 LLM 自主调用的基础网络请求工具，用于执行最基本的 HTTP/HTTPS 请求能力。

目标约束如下：
- 工具只负责“发起网络请求并返回结果”，不内置任何站点知识、搜索策略或业务语义。
- 去哪里查资料、查什么内容、何时发起请求，均由 LLM 基于对话上下文自行决定。
- 该工具需要注册到当前工具列表，纳入现有 tool calling 机制。
- 本次目标是“基本联网查询能力”，不是完整浏览器，不处理页面交互、登录态、JavaScript 渲染或多步工作流。

典型使用场景：
- 用户询问某个公开网页或接口上的最新信息，模型先判断本地知识不足，再调用联网工具。
- 用户让模型查询某个公开文档页面、静态网页、公开 JSON 接口或简单文本资源。
- 模型需要先发起 HTTP/HTTPS 请求，再基于响应内容生成最终答复。

非目标：
- 不实现搜索引擎策略。
- 不实现页面点击、表单填写、登录、Cookie 持久化。
- 不实现流式下载、文件落盘、图片识别。
- 不实现复杂爬虫能力。
- 不为特定站点写专门适配逻辑。

## 当前项目上下文
基于现有代码结构，本需求会落在 Electron Main Process 工具体系中：

- 工具注册入口：`e:\other-code\desktop-tools\src\main\tool-registry.ts:49`
- 工具执行分发：`e:\other-code\desktop-tools\src\main\tool-registry.ts:270`
- 现有工具实现文件：`e:\other-code\desktop-tools\src\main\system-tools.ts:1`
- 工具类型定义：`e:\other-code\desktop-tools\src\shared\tools.ts:1`
- 工具确认机制：`e:\other-code\desktop-tools\src\main\confirmation-service.ts:29`
- 日志脱敏逻辑：`e:\other-code\desktop-tools\src\main\audit-log.ts:10`
- Agent 多轮工具调用循环：`e:\other-code\desktop-tools\src\main\agent-service.ts:25`

现有框架特点：
- 所有工具统一由 `registeredTools` 暴露给模型。
- 参数必须先过 Zod 校验，再执行实际工具逻辑。
- `risk !== 'low'` 的工具会经过人工确认。
- 工具统一受 `10s` 执行超时控制：`e:\other-code\desktop-tools\src\main\tool-registry.ts:340`
- 已存在一个只读网络工具 `query_yy_user_info`，可作为网络请求实现风格参考：`e:\other-code\desktop-tools\src\main\system-tools.ts:283`

## 需求理解与实现边界
“最基本的网络请求功能”如果只做固定 URL 模板，无法满足“由 LLM 自己决定查哪里、查什么、何时查”的要求。因此本次工具需要支持“任意公开 URL + 基础请求参数”。

同时，若完全开放任意协议、任意方法、任意头、任意响应体，又会明显放大安全面和误用概率。因此需要在“基础能力”和“必要收敛”之间做平衡：

建议本次实现的最小可用能力为：
- 支持 `http` / `https` URL
- 支持常见只读查询方法：`GET`
- 支持可选请求头 `headers`
- 支持可选查询参数 `query`
- 返回响应状态码、响应头摘要、响应体文本摘要
- 对 JSON / text / html 统一按文本读取，不做 DOM 解析
- 对响应大小做截断，避免超大返回污染上下文

本次不建议开放：
- `POST` / `PUT` / `PATCH` / `DELETE`
- 任意二进制上传
- 本地文件协议
- 自定义超时时间
- 跟随重定向链的详细控制

原因：
- 用户要求是“联网查询”，语义明显偏只读检索而非远程写操作。
- 现有 confirmation 机制适合对外网访问做人工把关，但不适合再叠加高风险远程写操作。
- 在现有工具框架中，先交付 `GET` 版网络读取能力，复杂度最低，也最符合“最基本”要求。

## 总体技术方案
新增一个中风险工具 `http_request`，由 Main Process 直接使用 Node/Electron 环境下可用的 `fetch` 发起网络请求，并将结果以 `ToolResult` 结构回传给 LLM。

实现分为两层：

1. 在 `system-tools.ts` 中新增通用 HTTP 请求执行函数
   - 校验并规范化 URL
   - 仅允许 `http:` 与 `https:`
   - 强制请求方法为 `GET`
   - 合并 query 参数
   - 透传有限的请求头
   - 发起请求并处理 AbortSignal
   - 读取响应体文本
   - 根据内容类型决定摘要方式
   - 对响应头和响应体做截断与脱敏
   - 返回统一 `ToolResult`

2. 在 `tool-registry.ts` 中新增工具注册
   - 定义 JSON Schema 与 Zod 校验
   - 在 description 中明确该工具仅用于公开 HTTP/HTTPS 内容读取
   - 将工具加入 `registeredTools`
   - 将 risk 设为 `medium`，触发人工确认

## 数据流路径

```text
用户提问
  -> AgentService 将消息与工具列表发送给模型
  -> 模型判断是否需要联网
  -> 模型选择 http_request 并构造结构化参数
  -> tool-registry.ts 解析参数并做 Zod 校验
  -> confirmation-service.ts 请求用户确认外网访问
  -> system-tools.ts 执行 HTTP GET 请求
  -> 返回响应状态、头摘要、正文摘要
  -> AgentService 将 tool message 回填给模型
  -> 模型基于联网结果输出最终答复
```

## 工具设计

### 工具名
`http_request`

### 风险级别
`medium`

原因：
- 工具会访问任意外部 URL，属于对外网络出站能力。
- 虽然是只读 GET，但仍可能访问不期望的地址。
- 现有确认框架已经支持对 `medium` 工具逐次确认，适合本工具。

### 参数设计
建议使用如下结构：

```ts
{
  url: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}
```

说明：
- `url`：完整请求地址，必须为 `http://` 或 `https://`
- `query`：可选查询参数，键值均为字符串
- `headers`：可选请求头，键值均为字符串

Zod 校验建议：
- `url`: 非空字符串，最大长度限制，例如 `2048`
- `query`: 可选对象，value 必须为字符串，限制键数量与单值长度
- `headers`: 可选对象，value 必须为字符串，限制键数量与单值长度
- `additionalProperties: false`

为避免模型滥传超大参数，建议增加以下约束：
- `query` 最多 20 个键
- `headers` 最多 20 个键
- 单个 header key 最长 100
- 单个 header value 最长 500
- 单个 query value 最长 500

## 请求处理逻辑

### URL 规范化
执行前必须：
- 使用 `new URL(url)` 校验 URL 合法性
- 检查协议必须是 `http:` 或 `https:`
- 若调用方还传了 `query`，将其逐项写入 `searchParams`

示意代码：

```ts
const targetUrl = new URL(input.url);

if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
  return {
    ok: false,
    content: '',
    error: '仅支持 http 或 https 协议。',
  };
}

for (const [key, value] of Object.entries(input.query ?? {})) {
  targetUrl.searchParams.set(key, value);
}
```

### 请求头处理
允许模型传入基础请求头，但需要做收敛：
- 过滤空 key
- 统一 trim
- 不允许覆盖 `host`、`content-length` 等不应由工具侧手工设置的头
- 对 `authorization`、`cookie` 等敏感头在日志中不直接记录原值

建议最小策略：
- 请求可以带 headers
- 实际日志和 tool summary 中对敏感头只保留键名，不保留值

### 发起请求
使用全局 `fetch` 发起 GET：

```ts
const response = await fetch(targetUrl, {
  method: 'GET',
  headers: safeHeaders,
  signal,
  redirect: 'follow',
});
```

取消行为：
- 若收到 `AbortError`，统一抛出 `工具执行已取消。`
- 与现有 `queryYyUserInfo` 保持一致：`e:\other-code\desktop-tools\src\main\system-tools.ts:314`

### 响应体读取
本次实现只做“基础读取”，因此统一按文本读取：

```ts
const bodyText = await response.text();
```

处理策略：
- 若 `content-type` 包含 `application/json`，尝试格式化 JSON 摘要
- 若是 `text/html` / `text/plain` / 其他文本类型，直接截断返回
- 若是明显二进制类型，也不做二进制解析，而是返回“当前响应类型不适合文本读取”的错误或摘要信息

建议采用更稳妥的兼容策略：
- 始终先读 `text()`
- 若内容为空，则返回空文本
- 若长度超过上限，截断并标记已截断

## 返回结果设计
建议返回结构：

```ts
{
  ok: true,
  content: '...供模型直接消费的响应摘要...',
  data: {
    url: finalUrl,
    status: response.status,
    statusText: response.statusText,
    contentType,
    headers: headerSummary,
    bodyPreview,
    truncated: true,
  },
}
```

其中：
- `content`：优先给模型看的精简文本，避免过多噪音
- `data`：保留结构化调试信息

建议 `content` 模板：

```text
请求地址: {finalUrl}
HTTP 状态: {status} {statusText}
Content-Type: {contentType}
响应正文预览:
{bodyPreview}
```

若 JSON 可成功解析，可改为：

```text
请求地址: {finalUrl}
HTTP 状态: {status} {statusText}
返回 JSON 预览:
{formattedJsonPreview}
```

## 截断与摘要策略
为了避免把超大网页全文直接塞进上下文，需要明确限制。

建议：
- 响应正文预览最多保留 `8000` 字符
- 超过后在尾部追加 `\n...[truncated]`
- 响应头只保留前若干个常见字段或总数受限后的对象

建议保留的响应头：
- `content-type`
- `content-length`
- `last-modified`
- `etag`
- `cache-control`

这样既能给模型足够信息，又不会显著推高 token 消耗。

## 边界条件与异常处理
需要覆盖以下情况：

1. URL 非法
- 例如不是合法 URL 字符串
- 返回 `ok: false` 和明确错误

2. 协议不支持
- 非 `http:` / `https:` 直接拒绝

3. 请求被取消或超时
- 统一返回取消错误
- 仍遵守现有 10s 工具超时上限

4. DNS / TLS / 网络错误
- 返回结构化请求失败错误

5. HTTP 非 2xx
- 不应抛异常
- 仍返回状态码和响应体预览，帮助 LLM判断页面含义
- `ok` 建议仍为 `false`

6. 返回体过大
- 截断
- 标记 `truncated: true`

7. 返回为二进制或不可读文本
- 返回内容类型与简短说明
- 避免把乱码作为主要 `content`

8. 头信息中带敏感字段
- 日志脱敏
- `data.headers` 中只保留安全摘要，或对敏感值替换为 `***`

## 安全与实现取舍
本需求天然涉及网络外连。结合当前桌面 Agent 架构，建议采用以下取舍：

### 1. 开放任意 URL，但仅限 HTTP/HTTPS
这是满足“LLM 自己决定去哪里查”的必要条件。

### 2. 仅支持 GET
这是满足“联网查询”而非“远程写操作”的关键约束。

### 3. 设为 medium risk
因为任意出站访问不能视为低风险，应由用户逐次确认。

### 4. 不新增配置页开关
当前用户需求只是增加基础能力，不要求增加 UI 配置项。
本次直接复用工具确认机制，避免无关 UI 改动。

### 5. 不新增站点 allowlist
用户明确希望“由 LLM 自己决定去哪里查”。
如果做站点白名单，会直接削弱该需求目标。
当前更适合依赖：
- 协议限制
- 方法限制
- 人工确认
- 日志审计

### 6. 不在工具内做搜索增强
工具只提供网络 I/O，不负责“怎么找资料”，保持职责单一。

## 受影响文件

### 1. `e:\other-code\desktop-tools\src\main\system-tools.ts`
修改类型：扩展现有工具实现

预计新增内容：
- `http_request` 相关参数类型
- URL / headers / body preview 处理辅助函数
- 新增 `httpRequest(...)` 执行函数
- 响应摘要、错误处理、截断逻辑

预计受影响函数区域：
- import 区域可能补充辅助类型
- `queryYyUserInfo` 附近的网络请求风格可作为参考实现

### 2. `e:\other-code\desktop-tools\src\main\tool-registry.ts`
修改类型：扩展工具 schema 与注册表

预计新增内容：
- `httpRequestSchema`
- 顶部导入 `httpRequest`
- `registeredTools` 中新增 `http_request`

受影响位置：
- schema 定义区：`e:\other-code\desktop-tools\src\main\tool-registry.ts:20`
- 工具注册数组：`e:\other-code\desktop-tools\src\main\tool-registry.ts:49`

### 3. `e:\other-code\desktop-tools\src\main\audit-log.ts`
修改类型：增强脱敏规则

原因：
- 新工具可能携带 `Authorization`、`Cookie` 等请求头
- 当前仅脱敏 Bearer token 与 `sk-*` 模式，覆盖不够完整

预计新增内容：
- 对常见敏感头值的日志脱敏处理
- 避免请求头原值进入主日志与审计日志

### 4. `e:\other-code\desktop-tools\.comate\specs\basic-web-request-tool\tasks.md`
修改类型：后续新增任务拆解文档

### 5. `e:\other-code\desktop-tools\.comate\specs\basic-web-request-tool\summary.md`
修改类型：实现完成后新增总结文档

## 关键实现片段

### `system-tools.ts` 中的执行函数示意

```ts
export async function httpRequest(
  url: string,
  query?: Record<string, string>,
  headers?: Record<string, string>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  let targetUrl: URL;

  try {
    targetUrl = new URL(url);
  } catch {
    return {
      ok: false,
      content: '',
      error: '请求地址不是合法 URL。',
    };
  }

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return {
      ok: false,
      content: '',
      error: '仅支持 http 或 https 协议。',
    };
  }

  for (const [key, value] of Object.entries(query ?? {})) {
    targetUrl.searchParams.set(key, value);
  }

  let response: Response;

  try {
    response = await fetch(targetUrl, {
      method: 'GET',
      headers: sanitizeRequestHeaders(headers),
      signal,
      redirect: 'follow',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('工具执行已取消。');
    }

    return {
      ok: false,
      content: '',
      error: `网络请求失败：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }

  const contentType = response.headers.get('content-type') ?? '';
  const rawText = await response.text();
  const bodyPreview = truncateText(rawText, 8000);

  return {
    ok: response.ok,
    content: [
      `请求地址: ${targetUrl.toString()}`,
      `HTTP 状态: ${response.status} ${response.statusText}`,
      `Content-Type: ${contentType || 'unknown'}`,
      '响应正文预览:',
      bodyPreview,
    ].join('\n'),
    data: {
      url: targetUrl.toString(),
      status: response.status,
      statusText: response.statusText,
      contentType,
      bodyPreview,
      truncated: rawText.length > bodyPreview.length,
    },
    error: response.ok ? undefined : `请求返回非成功状态：${response.status}`,
  };
}
```

### `tool-registry.ts` 中的 schema 示意

```ts
const httpRequestSchema = z.object({
  url: z.string().min(1).max(2048),
  query: z.record(z.string().max(500)).optional(),
  headers: z.record(z.string().max(500)).optional(),
});
```

### 注册表示意

```ts
{
  name: 'http_request',
  description:
    '对任意公开 http/https 地址执行基础 GET 请求。适用于联网查询网页、文本或 JSON 内容。由模型自行决定是否调用、查询哪个地址以及何时查询。仅支持只读请求。',
  risk: 'medium',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '完整的 http/https 请求地址',
      },
      query: {
        type: 'object',
        description: '可选查询参数，键和值都应为字符串',
      },
      headers: {
        type: 'object',
        description: '可选请求头，键和值都应为字符串；仅用于基础读取场景',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  validator: httpRequestSchema,
  execute: async (args, context) => {
    const input = args as z.infer<typeof httpRequestSchema>;
    return httpRequest(input.url, input.query, input.headers, context.signal);
  },
}
```

## 预期结果
完成后，模型将获得一个新的联网工具能力：
- 能在需要时主动访问公开 HTTP/HTTPS 资源
- 能读取静态网页、公开 JSON 接口或文本内容
- 能把联网结果回填给模型，再由模型组织自然语言答案

效果上，用户无需明确指定“现在调用某个固定查询工具”，而是让模型自行决定：
- 是否需要联网
- 联网请求访问哪个地址
- 请求时带哪些基础 query/header
- 拿到响应后如何总结

## 实现取舍结论
本次方案选择：
- 做一个通用 `http_request` 工具
- 仅支持 `GET`
- 支持 `url + query + headers`
- 返回文本化响应摘要
- 响应做截断
- 工具风险设为 `medium`
- 适度增强日志脱敏

这是当前代码架构下满足用户需求的最小闭环实现，既能提供 LLM 自主联网查询能力，又避免把工具扩展成高风险、重交互的浏览器系统。