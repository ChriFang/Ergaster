# 隐藏会话气泡中的角色名称并保留必要识别信息

## 背景与目标
当前 `desktop-tools` 已完成多轮向 `agent-ui` 的视觉迁移，消息头像已经能够清晰区分用户、助手、工具和推理消息。但普通会话气泡头部仍显示“用户”“助手”等角色名称，造成额外的视觉噪声，也与 `agent-ui` 主要依靠图标/布局区分角色的风格不一致。

本轮目标是在不影响工具消息识别、推理消息语义和系统活动面板状态表达的前提下，移除普通会话气泡中的角色名称，仅通过头像、位置和现有配色来区分用户与助手。

## 需求场景与处理逻辑
### 场景 1：普通用户/助手会话气泡
- 用户消息当前在右侧显示头像，并在气泡头部显示“用户”。
- 助手消息当前在左侧显示头像，并在气泡头部显示“助手”。
- 由于头像、方向和气泡样式已经足够区分角色，本轮应移除这两类普通会话气泡头部的角色名称。
- 保持消息复制按钮、消息内容、右键菜单和现有水滴状气泡样式不变。

### 场景 2：工具消息仍保留必要标识
- 工具消息当前不仅显示“工具”，还可能展示 `tool: {name}`、执行成功/失败状态、展开/收起按钮和参数摘要。
- 为避免隐藏后工具消息失去语义锚点，本轮应保留工具消息的头部识别信息，至少保留其必要标题与工具名/状态区。
- 不改变工具消息的折叠/展开逻辑和状态展示。

### 场景 3：推理消息与系统活动面板保持现状
- 推理消息当前单独显示“思考过程”并带脑图标，这是内容语义的一部分，不应被隐藏。
- `ActivityPanel` 中的“系统”标题用于运行态/错误态提示识别，也不在本轮范围内。
- 因此本轮隐藏逻辑只针对普通会话气泡中的用户/助手角色名称，不扩散到推理与系统面板。

## 架构与技术方案
### 优先方案：仅调整 `MessageList.tsx` 中普通消息头部渲染逻辑
- 主要修改 `src/renderer/features/messages/MessageList.tsx`。
- 当前普通消息头部统一渲染：
  - `getRoleLabel(message)` → `message-role`
  - `message.name` → `message-label`
- 本轮将普通用户/助手消息的 `message-role` 渲染去掉，仅在工具消息需要时保留标题块。
- 推理消息分支与 `ActivityPanel.tsx` 保持不变。

### 不优先方案
- 不建议通过 CSS 直接隐藏 `.message-role`，因为该类在其他区域复用，可能误伤系统面板、确认/设置区域或侧边栏共用字体规则。
- 不修改 `message-model.ts` 的 `getRoleLabel` 映射逻辑，因为本轮不是删除角色概念，而是收窄展示范围。

## 影响文件
### 直接修改
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`
  - 修改类型：JSX 条件渲染调整
  - 影响函数：`MessageList`

### 原则上不改
- `e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts`
  - 保持角色文案映射不变
- `e:\other-code\desktop-tools\src\renderer\features\activity\ActivityPanel.tsx`
  - 保持“系统”标题不变
- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 如现有头部间距在删除标题后需要微调，仅允许做最小化局部调整

### 规格产物
- `e:\other-code\desktop-tools\.comate\specs\hide-chat-role-labels-in-bubbles\doc.md`
- `e:\other-code\desktop-tools\.comate\specs\hide-chat-role-labels-in-bubbles\tasks.md`
- `e:\other-code\desktop-tools\.comate\specs\hide-chat-role-labels-in-bubbles\summary.md`

## 实现细节
### 普通消息头部隐藏策略
当前普通消息头部逻辑为：
```tsx
<div className="message-card-header">
  <div>
    <div className="message-role">{roleLabel}</div>
    {message.name ? <div className="message-label">tool: {message.name}</div> : null}
  </div>
  <div className="message-header-actions">...</div>
</div>
```
本轮目标是：
- `user` / `assistant`：不再渲染 `message-role`
- `tool`：保留必要标题块和工具名
- `reasoning`：保持单独分支现状

可采用条件渲染，例如：
```tsx
const showRoleLabel = message.role === 'tool';
```
再按需输出头部左侧内容，避免影响右侧状态/展开按钮区域。

### 版式稳定性
- 删除普通角色标题后，普通用户/助手消息头部可能只剩右侧操作区。
- 如果现有 `message-card-header` 在无左侧内容时出现过大空白，可在 `MessageList.tsx` 中对非工具消息直接省略整个 header 容器，而不是仅省略文本节点。
- 选择哪种实现以“结构最简、影响面最小”为准。

## 数据流与调用链
- 消息渲染流保持不变：`App.tsx` → `ConsolePanel.tsx` → `MessageList.tsx` → `MessageContent.tsx`
- 本轮只改消息头部展示，不改消息解析、内容复制、右键菜单、工具折叠或会话状态流。

## 边界条件与异常处理
- 工具消息不能因为隐藏普通角色名称而失去必要的可识别性。
- 推理消息“思考过程”和系统活动面板“系统”必须保持不变。
- 普通消息复制按钮 hover、工具状态标签和展开按钮布局不能因头部条件渲染而错位。
- 若未来存在 `role: 'system'` 的普通消息进入 `MessageList`，本轮逻辑应避免错误地把它和工具消息一起误隐藏到不可识别。

## 预期结果
- 普通用户/助手消息气泡不再显示“用户”“助手”等角色名称。
- 工具消息、推理消息和系统活动面板继续保留必要识别信息。
- 会话区视觉更接近 `agent-ui` 的图标化消息风格，且 `npm run typecheck` 与 `npm run build` 继续通过。