# 修复输入记录文字下半部分被遮挡

## 背景
侧边栏“输入记录”区域中的文本目前使用单行省略样式显示，但从现象看，文字的下半部分被裁切，导致可读性差。根据当前样式实现，问题大概率集中在输入记录项的行高、容器高度计算以及单行裁切组合上。

## 需求场景与处理逻辑

### 场景 1：输入记录单行显示
- 用户查看侧边栏“输入记录”列表。
- 期望：每一行文字垂直居中、字形完整显示，超长文本可省略。
- 当前问题：文本下半部分被挡住，说明文字绘制区域小于实际字形占用高度，或父容器裁切过紧。

### 场景 2：高 DPI / Windows 字体渲染
- 在 Windows 桌面环境中，不同缩放比例下字体的 ascent / descent 可能与默认行高不完全匹配。
- 期望：在常见缩放比例下，输入记录项仍然稳定显示，不出现字底裁切。
- 当前问题：`font-size: 13px` 与默认行高组合可能过紧，单行裁切时更容易放大该问题。

## 根因分析
文件：`e:\other-code\desktop-tools\src\renderer\styles.css`

当前样式：
```css
.history-item {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: #cbd5e1;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

可疑点：
1. 未显式设置 `line-height`，依赖继承/浏览器默认值，可能导致 13px 文本在当前字体下垂直空间不足。
2. `overflow: hidden` + `white-space: nowrap` 会直接裁切超出盒模型高度的文字下沿。
3. 当前列表项未设置对齐方式，若盒模型在不同平台下高度略紧，字体下缘更容易被裁掉。

## 架构与技术方案

### 总体方案
仅调整渲染层输入记录项样式，不修改数据结构、业务逻辑和 IPC。

### 具体方案
针对 `.history-item`：
- 显式增加合理的 `line-height`
- 视需要改为 `display: flex` / `align-items: center` 或保持块级但确保内容高度足够
- 保留单行省略能力：`overflow: hidden`、`text-overflow: ellipsis`、`white-space: nowrap`
- 如有必要，为文本显示增加最小高度，保证 hover 背景与文字显示稳定

优先选择最小改动方案：
```css
.history-item {
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.5;
}
```

如果仅增加行高仍不足，再补充：
```css
.history-item {
  display: flex;
  align-items: center;
}
```

## 受影响文件

### 1. 输入记录样式文件
- 文件：`e:\other-code\desktop-tools\src\renderer\styles.css`
- 修改类型：样式微调
- 受影响选择器：
  - `.history-item`
  - 如有必要，少量关联 `.history-list`

## 实现细节

### 推荐实现方向
先以最小改动修复：
```css
.history-item {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: #cbd5e1;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

若仍存在裁切，可进一步采用更稳妥的单行布局方案：
```css
.history-item {
  display: flex;
  align-items: center;
  min-height: calc(13px * 1.5 + 16px);
}
```

这样可以同时解决两个问题：
1. `display: flex` + `align-items: center` 让文本在项内垂直居中。
2. `min-height` 为当前字体、行高和上下 padding 预留稳定高度，减少 Windows / 高 DPI 下的轻微字底裁切。

## 数据流
本问题仅涉及前端静态样式展示：
1. `App.tsx` 渲染输入记录列表
2. `styles.css` 控制 `.history-item` 的显示方式
3. 修复后不影响输入记录读取、存储、点击回填逻辑

## 边界条件与异常处理
- 超长文本仍应保持单行省略，不应换行撑高侧边栏。
- hover 背景不应因为样式修复而错位。
- 不修改输入记录的数据内容与顺序。
- 不扩大本次范围到“输入记录按智能体拆分”等功能性改造。

## 预期结果
- 输入记录每一行文字完整显示，不再出现字底/字形下半部分被遮挡。
- 超长文本仍以省略号形式展示。
- 样式修改仅影响输入记录视觉表现，不影响已有交互。

## 验证要点
1. 输入记录中的中文和英文都能完整显示。
2. 长文本仍为单行省略，不换行。
3. hover 高亮区域与文字垂直位置正常。
4. 类型检查或构建不受影响。