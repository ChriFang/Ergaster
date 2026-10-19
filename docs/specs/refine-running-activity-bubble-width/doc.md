# 收紧执行中气泡宽度并保持会话区视觉协调

## 背景与目标
当前会话区在用户发送消息后会展示 `ActivityPanel` 形式的“执行中”提示。相比已经迁移过的用户/助手消息气泡，这个运行态面板仍会横向占满整个会话区，导致右侧控制台在视觉上出现一个过宽的系统卡片，与当前更紧凑的 `agent-ui` 风格不协调。

本轮目标是在不改动运行态触发逻辑、文案逻辑和状态流的前提下，收紧“执行中”气泡宽度，使其与消息气泡体系更协调，并尽量保持错误态/确认态等相邻面板的现有行为稳定。

## 需求场景与处理逻辑
### 场景 1：用户发送消息后显示执行中提示
- 用户提交消息后，如果系统进入运行态且尚未显示可见的流式助手消息，会在会话区末尾显示 `ActivityPanel`。
- 该面板目前直接挂载在 `console-inline-panel` 下，没有复用普通消息的 `message-card-shell` 宽度约束，因此会占满整个 `console-message-stack` 可用宽度。
- 需要让运行态面板获得接近消息气泡的最大宽度和更合理的横向占位，从而与当前水滴状消息气泡体系协调。

### 场景 2：错误态活动面板保持可读性
- 同一 `ActivityPanel` 组件还承载执行失败的错误展示。
- 本轮收紧宽度时，错误态也应同步获得一致的宽度策略，避免运行态变窄而错误态继续满宽，造成系统面板风格割裂。
- 但不能因此影响错误内容的可读性，仍需允许长文本正常换行。

## 架构与技术方案
### 优先方案：仅通过 CSS 收紧活动面板宽度
- 保持 `ConsolePanel.tsx` 与 `ActivityPanel.tsx` 结构不变。
- 在 `src/renderer/styles.css` 中为 `console-inline-panel` 下的 `activity-panel` 增加局部宽度约束和对齐规则。
- 参考现有 `.message-card-shell` 的 `max-width: 700px` 策略，但考虑到“执行中”面板属于系统态提示，应比普通消息略紧凑或与其相当，而不是继续全宽。
- 推荐使用局部选择器，例如：
  - `.console-inline-panel .activity-panel`
  - 必要时配合 `.console-inline-panel` 自身的 `display`/`justify-content` 控制其在消息栈中的占位方式。

### 不采用的方案
- 不优先把 `ActivityPanel` 改造成完全复用 `message-row/message-stack/message-card-shell` 结构，因为这会引入额外 DOM 包裹层，超出本轮“只修正宽度协调性”的范围。
- 不改动 `use-chat-session.ts` 中运行态显示条件，也不改动 `ActivityPanel.tsx` 的文案/状态标签逻辑。

## 影响文件
### 直接修改
- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 修改类型：样式调整
  - 影响选择器：`.console-inline-panel`、`.activity-panel` 及其局部宽度约束

### 参考但原则上不改
- `e:\other-code\desktop-tools\src\renderer\features\activity\ActivityPanel.tsx`
  - 当前组件结构保持不变，除非样式实现受限才考虑最小化补充类名
- `e:\other-code\desktop-tools\src\renderer\features\layout\ConsolePanel.tsx`
  - 当前挂载结构保持不变，除非需要极小结构包裹辅助对齐

### 规格产物
- `e:\other-code\desktop-tools\.comate\specs\refine-running-activity-bubble-width\doc.md`
- `e:\other-code\desktop-tools\.comate\specs\refine-running-activity-bubble-width\tasks.md`
- `e:\other-code\desktop-tools\.comate\specs\refine-running-activity-bubble-width\summary.md`

## 实现细节
### 宽度收紧策略
建议优先采用局部选择器控制：
```css
.console-inline-panel {
  margin-top: 10px;
}

.console-inline-panel .activity-panel {
  width: fit-content;
  max-width: 700px;
}
```
实际实现时需兼顾当前 flex 布局行为，避免 `fit-content` 在 Electron 运行环境下出现不稳定表现。如存在兼容性顾虑，可改用：
```css
.console-inline-panel {
  display: flex;
}

.console-inline-panel .activity-panel {
  width: min(700px, 100%);
}
```
并通过 `align-self` 或 `justify-content` 保证其不再被拉满整行。

### 与现有消息体系协调
- 宽度收紧后，`ActivityPanel` 的边框、背景、状态标签和正文排版继续沿用当前活动面板语义，不强行改造成普通用户/助手气泡。
- 重点是让其横向节奏接近消息卡片，而不是占据整条消息栈宽度。

## 数据流与调用链
- 运行态状态流保持不变：`use-chat-session.ts` 控制显示条件 → `ConsolePanel.tsx` 在消息栈末尾渲染 `ActivityPanel.tsx`
- 本轮只改最终展示层，不改请求执行、流式输出、错误传递或确认流程。

## 边界条件与异常处理
- 长错误文本仍需正常换行，不能因为宽度收紧而发生内容溢出或横向截断。
- 当会话区较窄时，活动面板应能够自然缩到父容器宽度内，不能引入横向滚动。
- 确认面板 `ConfirmationPanel` 不应被本轮样式误伤，除非明确需要保持同样的窄宽度策略。
- 不能影响已经完成的消息气泡水滴状轮廓和右键菜单宽度修复。

## 预期结果
- 用户发送消息后的“执行中”气泡不再占满整个会话区，而是收紧到与现有消息体系协调的宽度。
- 错误态活动面板保持一致的宽度逻辑和良好的可读性。
- `npm run typecheck` 与 `npm run build` 继续通过。