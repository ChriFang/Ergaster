# 隐藏思维链期间的执行中气泡

## 需求背景
当前流式回复开始后，如果模型先输出 `reasoning_content` 而尚未输出正文 `content`，聊天区会先出现 assistant 的“思考过程”气泡；与此同时，底部仍会继续显示 `ActivityPanel` 的“执行中...”系统气泡。两者表达的是同一阶段的进行中状态，但来源不同，导致界面上出现重复状态提示。

本次改动目标是在 assistant 思维链气泡开始显示时，隐藏底部“正在执行中”气泡；错误态和工具确认态保持现有行为不变。

## 场景与处理逻辑
### 场景一：刚提交用户请求，尚未收到任何 assistant 流式内容
- `isRunning === true`
- `messages` 中还没有带 `reasoning_content` 的 assistant 流式消息
- 继续显示底部 `ActivityPanel` 运行态，向用户表示请求已发出、模型尚未开始返回可展示内容

### 场景二：已收到 reasoning 增量，但正文尚未开始
- `isRunning === true`
- 存在当前流式 assistant 消息，且 `reasoning_content` 非空
- 同时 `content_started !== true` 且 `content.length === 0`
- 聊天区显示“思考过程”气泡
- 底部 `ActivityPanel` 运行态隐藏，避免两个“处理中”提示并存

### 场景三：assistant 正文开始输出
- 当前 assistant 消息 `content_started === true` 或 `content.length > 0`
- 现有逻辑会隐藏 reasoning 独立气泡并显示 assistant 正文气泡
- 底部 `ActivityPanel` 是否显示取决于本次新增条件设计
- 为了保持“正文已经在消息区流式展示时，不再需要底部执行中卡片”的一致性，建议只要当前流式 assistant 已进入可见展示阶段（含 reasoning 或 content），运行态气泡都隐藏

### 场景四：执行失败
- `lastError` 有值
- 错误气泡仍由 `ActivityPanel` 渲染，不受“隐藏执行中气泡”规则影响

### 场景五：工具确认
- `confirmationRequest` 有值
- 继续沿用现有逻辑，底部 `ActivityPanel` 不显示，工具确认卡片优先

## 架构与技术方案
本次改动仅涉及 renderer 层展示条件，不改动主进程流式协议。

### 现状分析
- `src/renderer/App.tsx` 负责渲染底部 `ActivityPanel`
- `src/renderer/features/messages/MessageList.tsx` 负责依据单条消息字段判断是否显示 reasoning 气泡
- 目前二者互不感知，因此当 `isRunning` 和 `showReasoningBubble` 同时成立时，界面会并存两个进行中提示

### 方案
在 `App.tsx` 中新增一个派生判断，用于识别“当前是否已经有 assistant 流式内容正在聊天区展示”。

建议新增派生布尔值，例如：
```ts
const hasStreamingAssistantVisibleMessage = messages.some((message) => {
  if (message.role !== 'assistant') {
    return false;
  }

  const hasReasoning = (message.reasoning_content?.trim() ?? '').length > 0;
  const hasContentStarted = message.content_started === true || message.content.length > 0;
  return hasReasoning || hasContentStarted;
});
```

然后将 `ActivityPanel` 的运行态显示条件从：
```tsx
(isRunning || lastError) && !confirmationRequest
```
调整为区分错误态与运行态：
```tsx
const showRunningActivityPanel = isRunning && !confirmationRequest && !hasStreamingAssistantVisibleMessage;
const showErrorActivityPanel = Boolean(lastError) && !confirmationRequest;
```

渲染时改为：
```tsx
{(showRunningActivityPanel || showErrorActivityPanel) ? (
  <ActivityPanel isRunning={showRunningActivityPanel} errorMessage={showErrorActivityPanel ? lastError : null} />
) : null}
```

该方案的核心是：
- 只隐藏“运行中”卡片
- 不隐藏错误卡片
- 不改 `MessageList.tsx` 中 reasoning / assistant 气泡切换逻辑
- 不引入新状态，直接复用既有 `messages`、`isRunning`、`lastError`、`confirmationRequest`

## 影响文件
### 1. `e:\other-code\desktop-tools\src\renderer\App.tsx`
**修改类型**：条件渲染调整、派生状态补充  
**相关函数/区域**：
- `App()` 组件内的消息派生逻辑
- `ActivityPanel` 渲染条件区域

**预期修改点**：
- 新增用于判断 assistant 流式可见内容是否已开始显示的派生布尔值
- 收紧 `ActivityPanel` 运行态显示条件
- 保持 `lastError` 的渲染优先级

### 2. `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`
**修改类型**：预期不改或仅作对齐验证  
**相关函数/区域**：
- `showReasoningBubble`
- `showAssistantBubble`

**说明**：
- 当前 reasoning 气泡显示条件已经满足本次需求，不需要新增渲染改动
- 只需确保 `App.tsx` 的判断口径与这里保持一致：assistant 一旦有可见 reasoning 或正文，就说明聊天区已经承担了“执行中展示”职责

## 数据流路径
1. 主进程通过 `agent:stream` 推送 `deltaReasoningContent` / `deltaContent`
2. `App.tsx` 中的 `appendAssistantStreamDelta()` 将增量写入 `messages`
3. `MessageList.tsx` 根据消息字段显示 reasoning 气泡或 assistant 正文气泡
4. `App.tsx` 根据相同消息字段判断是否继续展示底部运行态 `ActivityPanel`
5. 当聊天区已开始显示 assistant 流式内容时，底部运行态卡片隐藏

## 边界条件与异常处理
- 若仅有空白 `reasoning_content`，不应触发隐藏运行态卡片，需使用 `trim()` 后判空
- 若某条 assistant 消息是历史消息，不应错误影响新一轮运行态展示；因此判断应优先围绕“当前 messages 中是否已有可见 assistant 流式内容”进行，结合现有运行流程，开始新请求时旧列表会保留，但新的用户消息会追加。为避免历史 assistant 内容误判，需要基于“当前正在流式更新的消息”或“最后一条 assistant 流式消息”进行约束，而不是扫描全部历史 assistant
- 更稳妥的实现建议是围绕 `activeStreamAgentIdRef` 对应的当前流式消息 ID 建立判断，或直接检测 `messages` 中最后一条 assistant 消息是否已具备 reasoning/content。考虑最小修改，可优先检测消息列表末尾最近的 assistant 消息
- 错误态 `lastError` 不能因 reasoning 显示而被隐藏
- 工具确认面板仍优先于 `ActivityPanel`

## 实现细节建议
为了避免历史 assistant 消息导致误判，建议在 `App.tsx` 增加一个针对“最近流式 assistant 消息”的查找逻辑，例如：
```ts
function getLatestAssistantMessage(messages: AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      return messages[index];
    }
  }

  return null;
}
```

再派生：
```ts
const latestAssistantMessage = useMemo(() => getLatestAssistantMessage(messages), [messages]);
const hasVisibleStreamingAssistantState = latestAssistantMessage
  ? ((latestAssistantMessage.reasoning_content?.trim() ?? '').length > 0
      || latestAssistantMessage.content_started === true
      || latestAssistantMessage.content.length > 0)
  : false;
```

最终条件：
```tsx
const showRunningActivityPanel = isRunning && !confirmationRequest && !hasVisibleStreamingAssistantState && !lastError;
const showErrorActivityPanel = Boolean(lastError) && !confirmationRequest;
```

## 预期结果
- 用户发起请求后，在模型尚未返回任何可见内容前，底部继续显示“执行中...”
- 一旦 assistant 思维链开始显示，底部“执行中...”立即隐藏
- assistant 正文开始显示后，仍不再恢复底部“执行中...”
- 错误场景继续显示错误卡片
- 不影响现有流式拼接、reasoning 显示、工具确认与消息渲染逻辑
