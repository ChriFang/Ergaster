# 工具消息卡片折叠/展开交互设计

## 背景
当前聊天区的工具消息卡片会直接展示完整内容。对于返回内容较长的工具调用，列表会被快速拉长，影响连续阅读与定位。需要为工具消息卡片增加折叠/展开能力，并默认以折叠状态展示。

## 需求范围
仅调整 `role === 'tool'` 的消息卡片展示行为：
- 默认折叠
- 折叠状态下仅显示标题和正文第一行内容
- 展开状态下显示完整内容
- 用户可在单条工具消息上独立切换折叠/展开

非工具消息（assistant/user/system）保持当前行为不变。

## 场景与处理逻辑
### 场景 1：工具消息首次渲染
- 当消息角色为 `tool` 时，界面为该卡片建立折叠状态，默认值为折叠。
- 标题区域继续展示角色、成功/失败状态。
- 如果存在 `message.name` 和 `toolPayload.summary`，继续作为工具卡片元信息显示。
- 正文区域仅渲染“第一行预览”，不直接展示全部 Markdown/JSON 内容。

### 场景 2：用户展开工具消息
- 用户点击“展开”按钮后，仅当前工具卡片切换为展开状态。
- 展开状态下恢复完整正文渲染：
  - Markdown 内容继续使用 `ReactMarkdown + remarkGfm`
  - JSON/纯文本内容继续使用 `<pre>` 的换行保留逻辑
- 复制按钮继续复制完整内容，而不是只复制预览内容。

### 场景 3：用户再次收起工具消息
- 点击“收起”后，该卡片返回折叠状态。
- 折叠状态下再次仅显示标题和正文第一行。
- 不影响其他工具卡片的展开状态。

### 场景 4：正文为空或只有单行
- 若工具消息没有额外正文，则折叠状态下仍显示当前兜底文案。
- 若正文只有一行，则折叠预览与完整内容视觉上可能一致，此时仍保留展开/收起入口，保证交互一致性。

## 技术方案
### 状态管理
在 `src/renderer/App.tsx` 的 `App()` 组件内新增按消息唯一键索引的折叠状态容器，例如：
- `collapsedToolMessages: Record<string, boolean>` 或 `Set<string>`
- 默认视为折叠；用户点击后切换该消息的状态

消息唯一键沿用当前列表渲染所使用的信息组合，至少包含：
- `message.role`
- `index`
- `message.tool_call_id ?? 'message'`

为避免 JSX 内联逻辑膨胀，建议抽出以下辅助逻辑：
- 生成工具消息唯一键
- 提取正文首行预览文本
- 判定当前工具消息是否折叠

### 正文预览生成
基于当前 `getMessageBodyModel()` 的结果生成预览文本：
- `body.text` 统一作为预览原始文本来源
- 取首个换行符前的内容作为“第一行”
- 对空白文本执行 `trim()` 判断；若结果为空，回退到原有兜底文案

建议新增类似函数：
```ts
function getCollapsedPreviewText(text: string) {
  const normalized = text.replace(/\r\n/g, '\n');
  const firstLine = normalized.split('\n')[0]?.trim();
  return firstLine || '工具已完成，但没有返回额外内容。';
}
```

### 视图渲染
当前工具消息渲染位于：
- `e:\other-code\desktop-tools\src\renderer\App.tsx:588`

调整方式：
1. 仅对工具消息追加可折叠类名与切换按钮
2. 折叠时：
   - 显示标题区域
   - 显示元信息（tool 名称、参数摘要）
   - 以单行文本形式显示正文第一行预览
3. 展开时：
   - 保持当前完整正文渲染方式
4. 切换按钮建议放在标题区域或正文区域顶部，文案为“展开 / 收起”

建议 JSX 结构示意：
```tsx
const messageKey = getMessageKey(message, index);
const isToolMessage = message.role === 'tool' && toolPayload;
const isCollapsed = isToolMessage ? isToolMessageCollapsed(messageKey) : false;
const previewText = isToolMessage ? getCollapsedPreviewText(body.text) : '';

{isToolMessage ? (
  <>
    <div className="message-header">
      ...
      <button type="button" className="message-toggle-button">{isCollapsed ? '展开' : '收起'}</button>
    </div>
    ...
    {isCollapsed ? (
      <div className="message-content message-content-collapsed">{previewText}</div>
    ) : (
      renderMessageBody(body, handleMessageContextMenu)
    )}
  </>
) : (
  <>
    <div className="message-header">...</div>
    {renderMessageBody(body, handleMessageContextMenu)}
  </>
)}
```

## 受影响文件
### 1. `e:\other-code\desktop-tools\src\renderer\App.tsx`
**修改类型**：编辑现有文件

**涉及位置**：
- `parseToolMessage` 附近的辅助函数区域 `e:\other-code\desktop-tools\src\renderer\App.tsx:46`
- `App()` 状态定义区域 `e:\other-code\desktop-tools\src\renderer\App.tsx:149`
- 消息列表渲染区域 `e:\other-code\desktop-tools\src\renderer\App.tsx:588`

**预期修改点**：
- 增加工具卡片折叠状态管理
- 增加工具消息唯一键与首行预览提取逻辑
- 在工具消息卡片中接入展开/收起按钮
- 根据折叠状态切换预览内容与完整内容

### 2. `e:\other-code\desktop-tools\src\renderer\styles.css`
**修改类型**：编辑现有文件

**涉及位置**：
- 消息卡片区域样式 `e:\other-code\desktop-tools\src\renderer\styles.css:268`
- 标题/正文相关样式 `e:\other-code\desktop-tools\src\renderer\styles.css:324`

**预期修改点**：
- 增加折叠预览样式，如单行截断、颜色与间距
- 增加展开/收起按钮样式，并与现有暗色界面风格统一
- 如有需要，为工具消息头部按钮布局增加对齐规则

## 数据流
1. 主进程工具执行结果通过 `tool-registry.ts` 被序列化为 tool message JSON
2. 渲染层 `parseToolMessage()` 将其解析为 `ToolMessagePayload`
3. `getMessageBodyModel()` 生成当前消息的完整正文模型
4. 新增预览提取逻辑从 `body.text` 中拿到第一行
5. 根据当前卡片折叠状态决定渲染预览或完整正文
6. 用户点击切换按钮后更新本地状态并重新渲染当前卡片

## 边界条件与异常处理
- 工具消息 JSON 解析失败时，继续走现有兜底逻辑，不额外引入新异常路径。
- 若 `toolPayload.content`、`error`、`data` 都不存在，折叠态和展开态都显示现有默认文案。
- 预览文本过长时使用 CSS 单行省略，不在逻辑层做额外裁剪。
- 折叠/展开状态只保存在当前渲染会话内，不要求持久化。
- 新增交互不能影响右键复制选中文本、复制完整消息、滚动到底部等现有行为。

## 实现约束
- 不新增组件文件，优先在现有 `App.tsx` 结构内完成。
- 不改变工具消息复制逻辑：复制按钮始终复制完整内容。
- 不修改主进程消息结构和 `AgentMessage` 类型定义。
- 不对 assistant/user 消息引入折叠逻辑，避免范围扩大。

## 预期结果
- 工具消息卡片默认收起，显著减少长内容卡片占用高度。
- 折叠状态下用户可快速识别工具名称、执行状态和正文首行。
- 展开后可查看完整 Markdown/JSON 内容，现有渲染能力保持不变。
- 交互范围收敛在前端渲染层，改动集中且可控。