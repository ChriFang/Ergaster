# MCP 服务编辑界面交互与尺寸修复方案

## 背景与目标
当前 MCP 服务编辑界面存在两个明确问题：

1. 打开 MCP 服务编辑界面后，点击弹窗外部区域会直接关闭整个 MCP 服务面板，导致编辑过程容易被中断。
2. 编辑界面中的“参数”和“环境变量”输入框复用了 `.agent-textarea`，高度过大，不适合当前短文本逐行编辑场景。

本次目标是在不改变 MCP 配置逻辑与主流程的前提下，修复弹窗交互并缩小这两个输入框尺寸。

## 当前实现分析

### 弹窗关闭原因
MCP 服务面板挂载在 `src/renderer/App.tsx` 的通用 modal 容器中，当前结构为：

```tsx
{showMcpModal && (
  <div className="modal-overlay" onClick={() => setShowMcpModal(false)}>
    <div className="modal-content skills-modal" onClick={(e) => e.stopPropagation()}>
      <McpServersPanel onClose={() => setShowMcpModal(false)} />
    </div>
  </div>
)}
```

这意味着：
- 点击 overlay 空白区域时，会触发 `setShowMcpModal(false)`
- 因为 MCP 编辑页本身就在这个 modal 内，所以只要用户点到弹窗外部，就会关闭整个面板

对于带有表单编辑状态的 MCP 配置页，这种“点击遮罩立即关闭”的行为不合适。

### 文本框过大的原因
在 `src/renderer/features/mcp/McpServersPanel.tsx` 中：

```tsx
<textarea id="mcp-args" className="agent-textarea" ... />
<textarea id="mcp-env" className="agent-textarea" ... />
```

而 `.agent-textarea` 在 `src/renderer/styles.css` 中定义为：

```css
.agent-textarea {
  min-height: 360px;
}
```

这个高度是为智能体正文编辑设计的，不适合 MCP 参数与环境变量这种较短、逐行配置输入。

## 修复方案

### 方案 1：禁止点击遮罩关闭 MCP 面板
对 MCP modal 单独调整行为：
- 点击弹窗外部区域时不关闭 MCP 服务面板
- 仅通过以下显式操作关闭：
  - 标题栏“关闭”按钮
  - 编辑页“返回列表”/“取消”仅切换面板内部视图，不关闭整个 modal

实现方式：
- 修改 `src/renderer/App.tsx` 中 MCP modal 的 overlay 点击逻辑
- 移除 MCP overlay 上的 `onClick={() => setShowMcpModal(false)}`
- 保留内部容器的事件隔离，避免未来扩展时误触

建议改为：

```tsx
{showMcpModal && (
  <div className="modal-overlay">
    <div className="modal-content skills-modal">
      <McpServersPanel onClose={() => setShowMcpModal(false)} />
    </div>
  </div>
)}
```

#### 预期效果
- 用户点击弹窗外部时，MCP 服务编辑界面保持打开
- 避免误触导致未保存内容丢失

### 方案 2：为 MCP 参数/环境变量提供专用小尺寸文本框
不再复用 `.agent-textarea`，而是为 MCP 编辑页增加专用样式类，例如：

```css
.mcp-editor-textarea {
  min-height: 90px;
}
```

用户要求改为原来 1/4 大小，当前 `.agent-textarea` 的 `min-height` 为 `360px`，因此目标高度应接近：

```text
360 / 4 = 90px
```

实现方式：
- 修改 `src/renderer/features/mcp/McpServersPanel.tsx`
  - 将“参数”和“环境变量”两个 `<textarea>` 的 class 从 `agent-textarea` 改为 MCP 专用类
- 修改 `src/renderer/styles.css`
  - 新增 `.mcp-editor-textarea` 样式
  - 复用当前输入框视觉风格，但把 `min-height` 调整为约 `90px`
  - 保持 `resize: vertical`，方便用户手动拉高

建议样式：

```css
.mcp-editor-textarea {
  width: 100%;
  min-height: 90px;
  padding: 12px 14px;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  color: #e5e7eb;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
}
```

#### 预期效果
- “参数”和“环境变量”输入框默认更紧凑
- 仍然可多行编辑
- 与智能体正文输入框视觉统一，但尺寸更符合 MCP 配置场景

## 受影响文件

### 必改文件
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - 调整 MCP modal 的 overlay 点击关闭行为
- `e:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`
  - 替换参数/环境变量文本框样式类
- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 新增 MCP 编辑页专用 textarea 样式

## 数据流与行为边界
- 本次仅修改 renderer 侧交互与样式
- 不改动：
  - MCP 配置保存逻辑
  - IPC / preload / main 进程逻辑
  - 编辑页表单字段解析逻辑
- 点击弹窗外部后不关闭，只影响 MCP modal，不影响其他设置/技能等弹窗现有行为

## 验证方案
1. 打开 MCP 服务面板并进入编辑页。
2. 点击弹窗外部区域，确认 MCP 面板不关闭。
3. 点击标题栏“关闭”按钮，确认 MCP 面板可正常关闭。
4. 查看“参数”“环境变量”输入框默认高度，确认约为原先 1/4。
5. 手动拖拽文本框，确认仍可垂直调整大小。
6. 执行：
   - `npm run typecheck`
   - `npm run build`

## 预期结果
1. MCP 服务编辑界面不再因点击遮罩误关闭。
2. “参数”“环境变量”输入框默认高度缩小到约 `90px`。
3. MCP 配置编辑与保存逻辑保持原有行为不变。