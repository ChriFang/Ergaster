# 参考 agent-ui 迁移水滴状会话气泡并修正右键菜单宽度

## 背景与目标
当前 `desktop-tools` 已完成两轮 `agent-ui` 视觉迁移，但右侧会话区仍有两个与参考项目不一致的问题：
1. 会话气泡整体还是常规圆角矩形，缺少 `agent-ui` 中更接近“水滴状”的轮廓感，用户/助手消息的外形区分仍不够强。
2. 右键菜单在当前样式叠加下会被异常拉宽到点击点右侧的大块区域，破坏了已收紧的控制台视觉密度。

本轮目标是在不修改消息渲染逻辑、上下文菜单行为逻辑和数据结构的前提下，仅通过组件微调和 CSS 迁移，补齐这两个视觉差异。

## 需求场景与处理逻辑
### 场景 1：会话气泡向 agent-ui 的水滴感靠拢
- 用户消息和助手消息继续沿用当前左右分布、头像和内容结构。
- 调整 `message-card-shell` 基础圆角策略，使其不再是统一圆角矩形，而是具备更明显的方向性轮廓。
- 用户消息与助手消息分别使用不同的非对称圆角组合，形成更接近 `agent-ui` 的“水滴状/气泡尾感”视觉。
- 推理消息和工具消息保留当前独立视觉语义，但需要继承更新后的总体圆角体系，避免与新的主消息气泡风格割裂。

### 场景 2：右键菜单恢复为紧凑悬浮菜单
- 当前右键菜单由 `MessageContextMenu` 根据鼠标坐标写入行内 `left/top`，但 `.message-context-menu` 在 `styles.css` 内存在两段定义。
- 旧定义中的 `right: 0` 与后续 `position: fixed` 同时生效后，浏览器会按左右边界推导宽度，造成菜单被撑大。
- 需要统一 `.message-context-menu` 的定位语义，确保它只按照鼠标坐标定位，并以内容宽度或显式紧凑宽度渲染。
- 保持消息复制与空白区“重置会话”共用同一菜单组件，不改状态流与事件入口。

## 架构与技术方案
### 会话气泡迁移方案
- 主要修改 `src/renderer/styles.css` 中以下选择器：
  - `.message-card-shell`
  - `.message-user .message-card-shell`
  - `.message-assistant .message-card-shell`
  - `.message-tool .message-card-shell`
  - `.message-reasoning-card .message-card-shell`
  - 如有必要，补充 `.message-row-user .message-card-shell` 或同级辅助选择器以强化左右方向感。
- 保持 `src/renderer/features/messages/MessageList.tsx` DOM 结构稳定，优先通过 CSS 完成水滴状效果。
- 若仅靠现有类名不足以稳定表达左右方向，可在 `MessageList.tsx` 中为用户/助手卡片补充最小化语义类名，但不改变内容层级与交互。

### 右键菜单宽度修正方案
- 统一 `styles.css` 中 `.message-context-menu` 的两处定义，去除与鼠标坐标菜单语义冲突的 `right: 0`、下拉式锚点写法或重复覆盖。
- 菜单保留 `position: fixed`，继续配合 `MessageContextMenu.tsx` 的行内 `left/top`。
- 将菜单宽度收敛到紧凑范围，例如使用 `min-width` + `width: max-content` 或保守固定宽度，同时约束菜单项的填充与字号延续当前紧凑风格。
- 如有必要，补充 `max-width` 或 `white-space` 规则，避免中文按钮文案触发异常换行或拉伸。

## 影响文件
### 直接修改
- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 修改类型：样式调整
  - 影响函数/选择器：消息气泡外观、右键菜单定位与宽度
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`
  - 修改类型：仅在必要时补充语义类名
  - 影响函数：`MessageList`
- `e:\other-code\desktop-tools\src\renderer\features\context-menu\MessageContextMenu.tsx`
  - 修改类型：仅在必要时微调菜单容器属性
  - 影响函数：`MessageContextMenu`

### 规格产物
- `e:\other-code\desktop-tools\.comate\specs\migrate-agent-ui-droplet-bubbles-and-fix-context-menu-width\doc.md`
- `e:\other-code\desktop-tools\.comate\specs\migrate-agent-ui-droplet-bubbles-and-fix-context-menu-width\tasks.md`
- `e:\other-code\desktop-tools\.comate\specs\migrate-agent-ui-droplet-bubbles-and-fix-context-menu-width\summary.md`

## 实现细节
### 会话气泡轮廓
可采用“统一大圆角 + 角色定制缺口角”的方式，例如：
```css
.message-card-shell {
  border-radius: 20px;
}

.message-assistant .message-card-shell {
  border-top-left-radius: 10px;
  border-top-right-radius: 20px;
  border-bottom-right-radius: 20px;
  border-bottom-left-radius: 20px;
}

.message-user .message-card-shell {
  border-top-right-radius: 10px;
  border-top-left-radius: 20px;
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
}
```
实际数值以 `desktop-tools` 当前更紧凑的布局为准，目标是保留 `agent-ui` 的方向感，而不是机械复制固定像素。

### 右键菜单宽度与定位
应收敛成单一定义，避免出现：
```css
.message-context-menu {
  position: absolute;
  right: 0;
}
```
与：
```css
.message-context-menu {
  position: fixed;
}
```
同时存在。最终实现应类似：
```css
.message-context-menu {
  position: fixed;
  min-width: 120px;
  width: max-content;
  max-width: 160px;
}
```
如 Electron 当前渲染环境对 `max-content` 表现不稳，则改用更保守的窄固定宽度。

## 数据流与调用链
- 消息渲染流保持不变：`App.tsx` → `ConsolePanel.tsx` → `MessageList.tsx` → `MessageContent.tsx`
- 右键菜单状态流保持不变：`use-context-menu.ts` 生成 `ContextMenuState` → `ConsolePanel.tsx` 渲染 `MessageContextMenu.tsx`
- 本轮只调整最终展示层，不改消息内容、复制动作、空白区菜单入口、会话重置逻辑。

## 边界条件与异常处理
- 工具消息折叠/展开态不能因圆角调整造成内容裁切、复制按钮遮挡或按钮 hover 区错位。
- 推理消息依旧需要保留与普通助手消息不同的识别度，不能因为统一圆角而丢失当前虚线/弱强调语义。
- 右键菜单修正后，消息选中文本右键与会话空白区右键都应保持可见且宽度稳定。
- 菜单宽度修正不能依赖英文文案长度假设，需要兼容现有中文按钮文本。

## 预期结果
- 会话区的用户/助手气泡更接近 `agent-ui` 的水滴状轮廓，视觉区分更明显，但不引入额外结构复杂度。
- 右键菜单恢复为紧凑悬浮块，不再从点击点横向撑满到会话区右侧。
- `npm run typecheck` 与 `npm run build` 继续通过。