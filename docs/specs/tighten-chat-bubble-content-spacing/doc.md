# 收紧会话气泡内文字上下留白以提升信息密度

## 背景与目标
当前 `desktop-tools` 的会话区已经完成多轮向 `agent-ui` 靠拢的视觉迁移，但消息气泡中的正文距离气泡顶部和底部仍偏大，导致同样高度下可见内容偏少，尤其在较长对话里会明显降低信息密度。

本轮目标是在不牺牲可读性的前提下，进一步收紧消息气泡内的上下留白，让普通消息、推理消息和工具消息都更紧凑，同时避免破坏当前已经完成的水滴状轮廓、角色图标化、工具消息结构和右键菜单等迁移成果。

## 需求场景与处理逻辑
### 场景 1：普通用户/助手消息
- 当前普通消息通常已经不再显示 header，但正文仍统一继承 `.message-content { margin-top: 10px; }`。
- 对于没有 header 的普通消息，这 10px 会直接变成无意义的顶部空白。
- 需要让这类正文在无 header 时贴近气泡顶部显示，同时适当收紧气泡底部留白。

### 场景 2：推理消息与工具消息
- 推理消息和工具消息仍保留 header，因此正文与 header 之间仍需要一定分隔，不能简单全部清零。
- 但整体上下 padding 仍可适度收紧，使这两类气泡与普通消息一起变得更紧凑。
- 工具消息若带参数摘要，还要避免 `header -> summary -> content` 三段累计留白过大。

### 场景 3：Markdown 与纯文本内容
- Markdown 渲染已经通过首尾选择器清除了内部首尾 margin，因此气泡外层留白的主要来源仍是卡片 padding 与 `.message-content` 顶部 margin。
- 本轮不优先改动 markdown 内部段落节奏，只在必要时调整外层容器 spacing，避免伤害正文可读性。

## 架构与技术方案
### 优先方案：局部收紧卡片 padding，并只移除无 header 正文的顶部 margin
- 主要修改 `src/renderer/styles.css` 中以下选择器：
  - `.message-card-shell`
  - `.message-content`
  - `.message-summary`（如工具消息仍偏松）
- 主要修改 `src/renderer/features/messages/MessageList.tsx`：
  - 为“没有 header 的普通消息正文”补充一个局部 class 或结构标记，用于只移除这类正文的顶部 margin。
- 这样可以把影响限定在消息气泡层，不波及全局 typography 和其它面板。

### 不优先方案
- 不优先修改 markdown 内部如 `p / ul / pre / table` 的默认段落间距，因为这会更直接影响阅读节奏，副作用更大。
- 不通过全局删除 `.message-content` 的 `margin-top` 来处理问题，因为推理消息和工具消息仍需要 header 下方的内容分隔。

## 影响文件
### 直接修改
- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 修改类型：样式调整
  - 影响选择器：`.message-card-shell`、`.message-content`、必要时 `.message-summary`
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`
  - 修改类型：为无 header 消息内容提供更精确的 spacing 标记
  - 影响函数：`MessageList`

### 原则上不改
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageContent.tsx`
  - 保持 markdown / pre 结构不变，除非局部 class 无法从 `MessageList.tsx` 稳定传达

### 规格产物
- `e:\other-code\desktop-tools\.comate\specs\tighten-chat-bubble-content-spacing\doc.md`
- `e:\other-code\desktop-tools\.comate\specs\tighten-chat-bubble-content-spacing\tasks.md`
- `e:\other-code\desktop-tools\.comate\specs\tighten-chat-bubble-content-spacing\summary.md`

## 实现细节
### 重点问题拆解
当前主要留白来源为：
```css
.message-card-shell {
  padding: 12px 14px;
}

.message-content {
  margin-top: 10px;
}
```
其中：
- `padding` 同时增加了顶部和底部留白；
- `margin-top` 对所有正文一刀切，但普通用户/助手消息很多时候并没有 header，因此顶部空白被放大。

### 推荐收紧方向
- 将 `.message-card-shell` 的上下 padding 小幅减少，例如从 `12px` 降到更紧凑的值。
- 对没有 header 的普通消息正文单独移除顶部 `margin-top`。
- 如工具消息展开态仍偏高，再适当减少 `.message-summary` 的 `margin-top`。

一个可行示意如下：
```css
.message-card-shell {
  padding: 10px 14px;
}

.message-content-no-header {
  margin-top: 0;
}
```
具体 class 命名可根据现有组件结构选择更贴合的表达，只要能稳定区分“有 header / 无 header”即可。

## 数据流与调用链
- 消息渲染流保持不变：`App.tsx` → `ConsolePanel.tsx` → `MessageList.tsx` → `MessageContent.tsx`
- 本轮只调整展示层 spacing，不改消息解析、复制、工具展开、右键菜单或会话状态流。

## 边界条件与异常处理
- 普通消息去掉顶部多余留白后，复制按钮 hover 区域不能与正文重叠或显得过于拥挤。
- 推理消息与工具消息需要保留足够的 header-content 层级感，不能因为过度压缩而显得挤在一起。
- 纯文本 `pre` 与 markdown 消息都要同步受益于更紧凑 spacing，但不能出现内容裁切。
- 不能破坏当前水滴状圆角、活动面板宽度收紧、角色名称隐藏等已完成迁移结果。

## 预期结果
- 普通用户/助手消息的正文将更贴近气泡顶部和底部，整体信息密度更高。
- 推理消息和工具消息也会适度收紧，但仍保留必要的层级与可读性。
- 会话区在同样视口下能显示更多消息内容，且 `npm run typecheck` 与 `npm run build` 继续通过。