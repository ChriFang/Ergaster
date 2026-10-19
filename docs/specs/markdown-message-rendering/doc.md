# markdown-message-rendering

## 背景
当前 AI 小助手的消息卡片在 `src/renderer/App.tsx` 中统一使用纯文本 `<pre>` 展示，LLM 返回的 Markdown 内容会被原样显示，无法正确渲染标题、列表、引用、代码块、表格和链接。虽然 assistant 消息已经支持 Markdown，但工具调用结果卡片中的 `tool` 消息仍然只按纯文本展示，导致工具返回的说明性内容、列表和代码片段可读性不足。

本需求目标是：让 AI 助手返回数据的卡片以及工具输出卡片都支持 Markdown 格式显示，并在不破坏现有消息流、复制能力和结构化数据展示能力的前提下，提升可读性与安全性。

## 需求场景与处理逻辑

### 场景 1：assistant 消息返回 Markdown 文本
- 输入来源：`deepseek-client.ts` 返回的 `assistant.content`
- 当前行为：在 `src/renderer/App.tsx` 中通过 `<pre className="message-content message-content-prewrap">` 直接显示纯文本
- 目标行为：将 `assistant.content` 按 Markdown 渲染，支持常见块级与行内语法
- 处理逻辑：
  1. 保持主进程与共享消息结构不变，继续以字符串透传 `message.content`
  2. 渲染层识别 `assistant` 消息后，将其文本交由 Markdown 渲染组件输出
  3. 对空字符串或仅空白字符串继续显示为空内容，不制造额外占位文本

### 场景 2：消息卡片复制与右键选择能力保持可用
- 当前行为：卡片支持右上角复制整条消息，以及右键复制选中内容
- 目标行为：在 Markdown 渲染后，复制按钮仍然复制消息的原始展示文本；右键复制选中内容继续基于浏览器选区工作
- 处理逻辑：
  1. 复制按钮继续基于原始 `displayText` 或可复制文本来源工作
  2. 不修改 `handleMessageContextMenu` 与 `copyText` 的对外行为
  3. Markdown 渲染组件不得阻断文本选中

### 场景 3：Markdown 渲染安全控制
- 风险：若直接将 Markdown 转为 HTML 并注入 DOM，可能引入 XSS
- 目标行为：默认不信任模型输出，不允许原始 HTML 直接执行
- 处理逻辑：
  1. 采用 React 生态下的安全 Markdown 渲染方案
  2. 禁止 raw HTML 直出，不使用 `dangerouslySetInnerHTML` 拼接未净化内容
  3. 仅支持 Markdown 语义渲染与 GFM 扩展；链接渲染为普通可点击链接样式，但不引入脚本执行能力

## 架构与技术方案

### 总体方案
保持主进程消息链路不变，仅在 renderer 层引入 Markdown 渲染能力。这样可以最小化改动范围，避免触碰 `agent-service.ts`、`deepseek-client.ts`、`shared/agent.ts` 中稳定的数据协议。

### 推荐技术选型
优先使用：
- `react-markdown`
- `remark-gfm`

原因：
- 与现有 React 19 渲染层契合
- 默认不会执行原始 HTML，比先转 HTML 再注入更安全
- 容易扩展 GFM 能力，覆盖表格、任务列表、删除线等常见 LLM 输出

### 渲染策略
1. `assistant` 消息：统一按 Markdown 渲染
2. `tool` 消息：
   - `payload.error`：渲染为错误文本区域，可复用 Markdown 组件
   - `payload.content`：按 Markdown 渲染
   - `payload.data`：使用 `<pre>` 等宽文本展示 JSON
3. `user` 消息：保持当前纯文本展示更稳妥，避免用户输入被当作富文本重新解释

### 组件组织建议
由于 `App.tsx` 已较长，建议提取一个轻量的渲染组件，例如：
- `src/renderer/components/message-body.tsx` 或
- `src/renderer/components/markdown-content.tsx`

职责：
- 接收 `role`、`toolPayload`、`rawText`
- 决定使用 Markdown 渲染还是预格式化文本渲染
- 统一输出消息正文 DOM 结构

如果为减少新文件数量，也可先在 `App.tsx` 内新增局部辅助函数/局部子组件完成；但优先级低于可维护性。

## 受影响文件

### 1. `e:\other-code\desktop-tools\package.json`
- 修改类型：新增依赖
- 影响内容：补充 Markdown 渲染所需库
- 预期变更：
  - 新增 `react-markdown`
  - 新增 `remark-gfm`

### 2. `e:\other-code\desktop-tools\src\renderer\App.tsx`
- 修改类型：核心渲染逻辑调整
- 影响函数/区域：
  - `parseToolMessage` 附近的 tool payload 处理逻辑
  - 当前消息列表渲染区域（约 `App.tsx:523-579`）
  - 复制按钮所依赖的文本来源
- 预期变更：
  - 引入 Markdown 渲染组件/库
  - 区分 assistant / user / tool 不同渲染方式
  - 将 tool 消息的文本内容与结构化数据分开展示

### 3. `e:\other-code\desktop-tools\src\renderer\styles.css`
- 修改类型：样式增强
- 影响区域：消息卡片正文样式（当前 `.message-content`、`.message-content-prewrap` 一带）
- 预期变更：
  - 为 Markdown 容器增加标题、列表、引用、链接、代码块、表格样式
  - 为 JSON 预格式化内容保留换行、滚动与断行策略
  - 避免 Markdown 元素撑坏当前卡片布局

### 4. 可选新增文件
- `e:\other-code\desktop-tools\src\renderer\components\...`
- 修改类型：新增渲染组件
- 说明：仅在提取消息正文渲染逻辑时需要；若最终在 `App.tsx` 内实现，可不创建

## 实现细节

### 数据流路径
1. 用户发送请求：`src/renderer/App.tsx` → `window.desktopApp.runAgent`
2. IPC 转发：`src/preload/index.ts` → `src/main/index.ts`
3. 模型返回：`src/main/deepseek-client.ts`
4. Agent 聚合消息：`src/main/agent-service.ts`
5. renderer 接收 `response.messages`
6. `App.tsx` 对每条消息判断角色并选择渲染方式

### 建议的正文渲染抽象
可以引入类似以下的数据判定逻辑：

```ts
function getMessageBodyModel(message: AgentMessage) {
  const toolPayload = message.role === 'tool' ? parseToolMessage(message.content) : null;

  if (message.role === 'tool' && toolPayload) {
    if (toolPayload.error) {
      return { kind: 'markdown', text: toolPayload.error, copyText: toolPayload.error };
    }

    if (toolPayload.content) {
      return { kind: 'markdown', text: toolPayload.content, copyText: toolPayload.content };
    }

    if (toolPayload.data !== undefined) {
      const json = JSON.stringify(toolPayload.data, null, 2);
      return { kind: 'code', text: json, copyText: json };
    }

    return {
      kind: 'markdown',
      text: '工具已完成，但没有返回额外内容。',
      copyText: '工具已完成，但没有返回额外内容。',
    };
  }

  if (message.role === 'assistant') {
    return { kind: 'markdown', text: message.content, copyText: message.content };
  }

  return { kind: 'plain', text: message.content, copyText: message.content };
}
```

对应渲染：

```tsx
{body.kind === 'markdown' ? (
  <div className="message-content message-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{body.text}</ReactMarkdown>
  </div>
) : body.kind === 'code' ? (
  <pre className="message-content message-content-prewrap message-content-code">{body.text}</pre>
) : (
  <pre className="message-content message-content-prewrap">{body.text}</pre>
)}
```

### 样式建议
需要为 Markdown 容器新增类似规则：

```css
.message-markdown {
  word-break: break-word;
}

.message-markdown > :first-child {
  margin-top: 0;
}

.message-markdown > :last-child {
  margin-bottom: 0;
}

.message-markdown pre {
  overflow-x: auto;
  padding: 12px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.72);
}

.message-markdown code {
  font-family: Consolas, 'Courier New', monospace;
}

.message-markdown table {
  width: 100%;
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}
```

## 边界条件与异常处理

### 空内容
- assistant/tool 返回空字符串时，不抛异常
- Markdown 组件接收空字符串应正常渲染为空区域

### 结构化数据展示
- `payload.data` 为对象/数组时，继续展示为 JSON 文本
- 不对对象数据做 Markdown 解析，避免丢失层级信息

### 长代码块与宽表格
- 代码块和表格必须支持横向滚动
- 卡片宽度保持在现有最大宽度约束内，不撑破布局

### 链接展示
- 链接应具备清晰样式
- 不在本次需求中额外扩展复杂的外链打开策略；遵循浏览器默认可点击能力或项目现有行为

## 验收预期
1. assistant 返回以下 Markdown 时，卡片能正确展示标题、列表、代码块：

```markdown
# 标题
- 项目一
- 项目二

```ts
console.log('hello');
```
```

2. tool 消息的 `payload.data` 仍以结构化文本方式显示，不被错误渲染成 Markdown
3. 复制整条消息仍能复制原始文本内容
4. 右键复制选中内容仍可用
5. 未引入 `dangerouslySetInnerHTML` 等未净化 HTML 注入方式
6. `npm run typecheck` 与 `npm run build` 通过

## 预期结果
完成后，AI 小助手消息卡片会从“纯文本回显”升级为“结构化 Markdown 阅读体验”：
- LLM 回答更易读
- 工具返回中的说明性文本更易读
- 现有消息协议不需要变更
- 风险控制集中在 renderer 层，改动范围明确且可测试
