# 会话正文改为 14px

## 背景与目标
当前会话消息正文使用 `.message-content` 统一控制间距、行高和颜色，但未显式设置字体大小，因此继承默认字号。目标是在不影响整体布局和非正文元素字号的前提下，将会话正文显示字号固定为 14px。

## 需求场景与处理逻辑
### 场景一：普通文本消息
- 用户和助手的普通文本消息正文都通过 `message-content` 渲染。
- 在正文容器上增加 `font-size: 14px;`，使普通消息正文统一使用 14px。

### 场景二：Markdown 渲染消息
- Markdown 正文节点同时带有 `message-content message-markdown` 类。
- 由于 `message-markdown` 不单独定义基础字号，正文容器增加 `font-size: 14px;` 后，段落、列表、引用等常规文本将继承 14px。
- 标题仍保留现有相对更大的字号定义，不强行改小。

### 场景三：预格式化/折叠态正文
- 预格式化内容使用 `message-content message-content-prewrap` 类。
- 折叠态预览使用 `message-content message-content-collapsed` 类。
- 二者都继承 `message-content` 的基础字号，因此会同步变为 14px，无需额外改动。

## 架构与技术方案
- 渲染层采用 React + 单一全局样式文件 `src/renderer/styles.css`。
- 会话正文基础样式统一收敛在 `.message-content` 规则中。
- 最小修改方案是在 `.message-content` 中新增 `font-size: 14px;`，避免修改组件结构或引入新的样式类。

## 影响文件
### 1. 样式文件
- 修改类型：编辑现有样式规则
- 绝对路径：`e:\other-code\desktop-tools\src\renderer\styles.css`
- 影响规则：`.message-content`
- 预期改动：新增 `font-size: 14px;`

### 2. 受影响但无需修改的调用点
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageContent.tsx`
  - 相关节点：普通正文 / Markdown / pre 内容的 `message-content` className
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`
  - 相关节点：折叠态预览的 `message-content` className

## 实现细节
目标样式片段如下：

```css
.message-content {
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: #e5e7eb;
}
```

## 数据流路径
1. 消息数据进入消息列表组件。
2. `MessageList` / `MessageContent` 输出带有 `message-content` 的 DOM 节点。
3. `src/renderer/styles.css` 中的 `.message-content` 规则生效。
4. 浏览器渲染会话正文为 14px。

## 边界条件与异常处理
- Markdown 标题 `h1/h2/h3` 在现有规则中使用更大的显式字号，仍会覆盖基础 14px，这是预期行为。
- 行内代码和代码块保持现有单独样式；若其内部文本由容器继承基础字号，则会与 14px 基线对齐。
- 本次不调整角色标签、状态信息、按钮、输入框等非正文元素字号。
- 本次不新增响应式分支，因为 14px 作为固定正文基线在现有媒体查询下可直接复用。

## 预期结果
- 会话正文默认显示为 14px。
- 普通消息、折叠态预览、预格式化正文在视觉上统一缩放到 14px 基线。
- 不改变现有组件结构，不影响除会话正文外的其他 UI 字号策略。