# 对话内容复制功能设计

## 背景
当前聊天界面中的单条消息渲染集中在 `e:\other-code\desktop-tools\src\renderer\App.tsx`，消息内容展示使用 `<pre className="message-content message-content-prewrap">` 输出文本，浏览器原生支持文本选中，但项目内尚未提供：
1. 针对消息文本选区的明确复制入口；
2. 针对整条请求/回答内容的快捷复制入口；
3. 与 Electron 主进程集成的稳定复制能力。

本次新增两类复制能力：
- 选中单次请求或回答中的部分文本后，通过右键菜单执行复制；
- 鼠标悬停到单条对话消息上时，在消息框右上角显示复制图标，点击后复制该条完整内容。

## 需求场景与处理逻辑

### 场景一：复制单条消息中的部分内容
**用户流程**
- 在某一条请求或回答文本区域内按住鼠标左键拖动，形成文本选区；
- 在选区上点击鼠标右键；
- 弹出自定义右键菜单，提供“复制”操作；
- 点击“复制”后，将当前选中的文本写入系统剪贴板。

**处理逻辑**
- 仅当右键事件发生时，当前消息区域内存在非空文本选区，才展示自定义右键菜单；
- 菜单操作读取 `window.getSelection()` 的字符串结果，去除首尾空白后校验；
- 复制成功后关闭菜单，并给出轻量反馈；
- 如果没有有效选区，则不展示该菜单，避免误触。

### 场景二：复制单条完整请求或回答内容
**用户流程**
- 将鼠标移动到单条消息卡片区域；
- 在该消息卡片右上角出现复制图标按钮；
- 点击复制图标后，将该条消息完整文本复制到系统剪贴板。

**处理逻辑**
- hover 状态仅影响当前消息卡片；
- 完整文本来源与当前渲染内容一致：
  - `tool` 消息复制 `formatToolDetails(payload)` 的结果；
  - 普通 `user/assistant` 消息复制 `message.content`；
- 按钮点击后不影响消息选中、滚动、输入框状态；
- 成功后显示短暂状态提示，失败时更新状态文案。

## 架构与技术方案

### 复制通道
优先采用 Electron 原生剪贴板能力，而不是直接依赖 `navigator.clipboard`：
- 在主进程中增加 `clipboard:write-text` IPC handler；
- 在 preload 中通过 `contextBridge` 暴露 `copyText(text: string)`；
- 在 renderer 中统一通过 `window.desktopApp.copyText()` 进行复制。

**选择该方案的原因**
- 当前应用运行在 Electron `contextIsolation: true` 环境下，`src/main/index.ts:27-32` 已启用 preload 桥接，沿用现有 IPC 架构更符合项目当前模式；
- 原生剪贴板 API 权限与行为更稳定，避免受页面 Clipboard API 可用性限制；
- 后续如果需要扩展为“复制并提示”“记录复制审计”等能力，主进程桥接更容易演进。

### 右键菜单方案
在 renderer 中实现轻量自定义上下文菜单，而不是依赖系统默认菜单：
- 在消息内容节点上监听 `onContextMenu`；
- 判断当前是否存在有效选区；
- 若有，则阻止默认行为并在鼠标位置展示一个最小菜单层；
- 菜单层仅包含“复制”按钮，点击后走统一复制流程。

### hover 复制按钮方案
在单条消息卡片中新增复制按钮节点：
- 按钮挂载在消息卡片顶部区域，视觉上定位到右上角；
- 默认隐藏，在 `.message:hover` 或键盘聚焦时显示；
- 点击后复制当前消息完整文本。

### 状态反馈
沿用当前页面已存在的 `runStatus` 状态文案：
- 成功复制部分文本：`已复制选中内容。`
- 成功复制整条消息：`已复制完整消息内容。`
- 复制失败：`复制失败，请重试。`

这样无需新增全局 toast 体系，保持改动聚焦。

## 影响文件

### 1. `e:\other-code\desktop-tools\src\shared\contracts.ts`
**修改类型**：扩展类型定义  
**影响内容**：为 `DesktopAppApi` 新增 `copyText(text: string): Promise<void>`。

### 2. `e:\other-code\desktop-tools\src\preload\index.ts`
**修改类型**：扩展 preload 桥接  
**影响内容**：新增 `copyText` 方法，通过 `ipcRenderer.invoke('clipboard:write-text', text)` 调用主进程。

### 3. `e:\other-code\desktop-tools\src\main\index.ts`
**修改类型**：扩展主进程 IPC  
**影响内容**：
- 引入 `clipboard`；
- 注册 `ipcMain.handle('clipboard:write-text', ...)`；
- 对入参做最小校验，仅接受字符串。

### 4. `e:\other-code\desktop-tools\src\renderer\App.tsx`
**修改类型**：扩展消息渲染与交互逻辑  
**影响函数/区域**：
- `App` 组件状态区：新增右键菜单状态、hover/复制状态控制；
- 消息列表渲染区域 `src\renderer\App.tsx:469-494`：
  - 在单条消息卡片中加入复制按钮；
  - 在消息内容节点上挂载右键事件；
  - 新增上下文菜单层；
  - 统一封装复制动作。

### 5. `e:\other-code\desktop-tools\src\renderer\styles.css`
**修改类型**：补充样式  
**影响内容**：
- 消息卡片 hover 显示复制按钮；
- 复制按钮的尺寸、颜色、定位；
- 右键菜单层样式；
- 保证深色主题和现有消息卡片风格一致。

## 详细实现说明

### A. 共享复制方法
在 `App` 组件内新增一个统一方法，例如：

```ts
async function copyMessageText(text: string, successMessage: string) {
  const normalized = text.trim();
  if (!normalized) {
    setRunStatus('没有可复制的内容。');
    return;
  }

  try {
    await window.desktopApp.copyText(normalized);
    setRunStatus(successMessage);
  } catch {
    setRunStatus('复制失败，请重试。');
  }
}
```

用途：
- hover 按钮复制整条消息时复用；
- 右键菜单复制选中内容时复用。

### B. 完整消息复制文本来源
对每条消息沿用当前展示逻辑：

```ts
const toolPayload = message.role === 'tool' ? parseToolMessage(message.content) : null;
const displayText = toolPayload ? formatToolDetails(toolPayload) : message.content;
```

点击按钮后：

```ts
await copyMessageText(displayText, '已复制完整消息内容。');
```

这样能保证“复制的文本”和“界面看到的文本”一致。

### C. 选区复制逻辑
在消息内容 `pre` 节点挂 `onContextMenu`：

```ts
function handleMessageContextMenu(event: React.MouseEvent<HTMLElement>) {
  const selectedText = window.getSelection()?.toString().trim() ?? '';
  if (!selectedText) {
    return;
  }

  event.preventDefault();
  setContextMenuState({
    visible: true,
    x: event.clientX,
    y: event.clientY,
    selectedText,
  });
}
```

菜单点击后：

```ts
await copyMessageText(contextMenuState.selectedText, '已复制选中内容。');
setContextMenuState(null);
```

### D. 关闭菜单逻辑
需要在以下时机关闭菜单：
- 点击页面其它区域；
- 滚动聊天区域；
- 按下 `Escape`；
- 完成复制后。

建议通过 `useEffect` 绑定全局 `pointerdown` / `keydown` 清理逻辑，并在卸载时移除监听。

### E. 样式结构建议
可在消息卡片中新增如下结构：

```tsx
<article className="message ...">
  <button className="message-copy-button" type="button">复制</button>
  <div className="message-header">...</div>
  <pre className="message-content ...">...</pre>
</article>
```

样式要点：
- `.message { position: relative; }`
- `.message-copy-button` 默认透明、不可见；
- `.message:hover .message-copy-button, .message-copy-button:focus-visible` 时显示；
- 定位到消息框右上角，避免覆盖角色标签和执行状态。

## 边界条件与异常处理

### 文本选区边界
- 若用户在多条消息之间跨节点选择文本，本次仅支持从触发右键的当前页面选区中读取字符串，不额外拆分来源；
- 若选区为空、只有空格或换行，不展示复制菜单；
- 若右键时浏览器选区尚未形成有效文本，不拦截默认行为。

### 消息类型边界
- 用户消息、助手消息、工具消息都允许整条复制；
- `tool` 消息复制的是格式化后的可读文本，不复制原始 JSON。

### 交互边界
- hover 按钮仅在鼠标进入单条消息时展示，不应常驻影响阅读；
- 复制按钮需要支持键盘聚焦，避免仅鼠标可用；
- 打开设置面板、确认面板、执行状态面板时不影响消息复制功能。

### 错误处理
- IPC 复制失败时捕获异常并更新 `runStatus`；
- 上下文菜单状态异常时优先关闭菜单，避免残留悬浮层；
- 不新增持久化状态，不影响消息历史和 Agent 执行流程。

## 数据流路径

### 整条消息复制
1. 用户 hover 某条消息；
2. renderer 展示复制按钮；
3. 用户点击按钮；
4. `App.tsx` 读取该消息当前展示文本；
5. 调用 `window.desktopApp.copyText(text)`；
6. preload 转发到 `ipcRenderer.invoke('clipboard:write-text', text)`；
7. main 进程调用 `clipboard.writeText(text)`；
8. renderer 更新 `runStatus`。

### 部分内容复制
1. 用户在消息文本中选中部分内容；
2. 用户右键触发消息内容节点的 `onContextMenu`；
3. renderer 读取 `window.getSelection()`；
4. 若存在有效文本，则展示自定义菜单；
5. 用户点击菜单中的“复制”；
6. 与整条复制走相同 IPC 剪贴板路径；
7. renderer 关闭菜单并更新 `runStatus`。

## 预期结果
- 用户可以在任意单条请求/回答内容中，选中部分文本并通过右键复制；
- 用户可以在任意单条请求/回答/工具消息上 hover 后点击复制图标，复制整条内容；
- 复制行为稳定依赖 Electron 原生剪贴板；
- 不改变现有消息结构、不影响发送消息、取消执行、重置会话等现有功能；
- 所有改动聚焦在现有 Electron IPC 和 React 单文件消息渲染结构内，便于维护和后续扩展。
