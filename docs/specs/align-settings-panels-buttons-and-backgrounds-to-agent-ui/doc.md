# 设置管理界面背景与按钮风格继续对齐 agent-ui

## 需求场景与处理逻辑
本轮需求是在已完成设置弹窗大迁移、标题收口、switch 与字体迁移的基础上，继续向 `agent-ui` 的设置区视觉语言靠拢，重点处理以下五项：
- 智能体管理、Skills 管理、MCP 管理、关于界面的背景色与背景风格进一步对齐；
- 所有设置管理界面中的编辑按钮和删除按钮风格统一；
- 所有设置界面中的“保存”“取消”按钮风格统一；
- 删除 Skills 管理界面中的 skills 存储目录显示；
- 删除智能体管理界面中的存储目录显示。

用户已提供参考工程路径 `E:\other-code\agent-ui`。结合现有项目与参考项目的对比，当前差异主要集中在：
- `desktop-tools` 的设置页卡片背景、边框和阴影仍比 `agent-ui` 更厚重；
- 编辑/删除图标按钮仍延续旧样式，尚未完全收敛到 `agent-ui` 的统一 icon button 语义；
- `save-button` / `cancel-button` / `primary-button` / `ghost-button` 仍存在多套并行视觉；
- Skills 与 Agents 页面顶部工具区仍展示本地目录文本，这一信息在 `agent-ui` 中不存在，破坏了界面简洁度。

本轮处理原则：
- 优先在 renderer JSX 与 `styles.css` 中完成，保持最小改动；
- 不修改现有 IPC、main process、shared contracts 或持久化数据结构；
- 保留现有行为能力，例如“打开目录”“创建”“保存”“取消”“编辑”“删除”仍照常工作，只调整视觉表达与不再渲染目录文本；
- 尽量复用已有 class 结构，在必要时为共享视觉收口增加少量 modifier class，而不是引入新的组件体系。

## 架构与技术方案
实现分为四个方向：

1. 设置主面板背景风格收口
   - 统一调整设置弹窗内容区、`settings-surface-card`、`agents-panel`、`skills-panel`、`mcp-editor`、`about-panel-card` 等容器的背景、边框、阴影与高光层级；
   - 参考 `agent-ui` 中 `bg-popover`、`bg-muted/20`、`bg-muted/30`、`border-border`、`ring-1 ring-foreground/10` 的暗色卡片风格，在当前 CSS 体系里映射为更轻的背景、描边与柔和阴影；
   - about 页面虽是独立结构，但需要与三类管理页面处于同一视觉体系，而不是单独一套更亮或更厚的卡片。

2. 编辑/删除图标按钮风格统一
   - 当前 Agents、Skills、MCP 列表都使用 `edit-button icon-button`、`delete-button icon-button` 组合；
   - 保留这些 class 名以减少 JSX 改动，但统一其视觉基座：尺寸、圆角、边框、前景色、hover 反馈保持一致；
   - 删除按钮保留危险语义，但只在 hover / focus 时显著偏红，贴近 `agent-ui` 的 `danger` icon button 习惯，而不是默认过强强调。

3. 保存/取消按钮风格统一
   - 当前 AgentEditor、SkillEditor、McpServersPanel 编辑器、MCP 默认绑定编辑，以及通用设置页，分别使用 `save-button`、`cancel-button`、`primary-button`、`ghost-button` 等不同样式；
   - 统一规则为：
     - 保存类主操作 = 紧凑主按钮（深色/高对比填充、统一高度、统一边框与圆角）；
     - 取消类次操作 = ghost / 次级按钮（透明或弱底色、统一高度与圆角）；
   - 尽量通过 CSS 将这些已有类收敛到相同视觉语言，若某些 JSX 使用了不同类名但语义等价，可在选择器层面并联处理。

4. 移除 Skills 与 Agents 目录文本显示
   - 在 `SkillsPanel.tsx` 中删除 `skillsDirectory` 文本渲染；
   - 在 `AgentsPanel.tsx` 中删除 `agentsDirectory` / `目录未加载` 文本渲染；
   - 保留“打开目录”按钮，不影响本地目录访问能力；
   - 若目录状态变量因此仅剩加载用途但不再参与渲染，则继续保留其获取逻辑或视实际代码耦合程度做最小清理，但不扩大到 IPC 接口删除。

## 影响文件
- 修改 `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`
  - 删除存储目录文本渲染；必要时微调顶部工具区结构。
- 修改 `e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx`
  - 删除 skills 存储目录文本渲染；必要时微调顶部工具区结构。
- 修改 `e:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`
  - 若需统一编辑器按钮结构，可能只需保持 JSX 不动，主要依赖共享 CSS；如发现局部按钮 class 不一致，则做最小 JSX 收口。
- 修改 `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
  - 若需统一保存/取消按钮 class 语义或结构，做最小 JSX 调整；优先不改逻辑。
- 修改 `e:\other-code\desktop-tools\src\renderer\features\skills\SkillEditor.tsx`
  - 同上，确保保存/取消与其他编辑器一致。
- 修改 `e:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx`
  - 让通用设置页保存按钮与其他设置编辑主按钮处于同一视觉体系；若取消类未出现则不强行新增。
- 修改 `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - 如关于页背景风格统一需要局部结构辅助类，可在此做最小调整；若纯 CSS 可完成，则不改 JSX。
- 修改 `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 本轮主要实现面：背景卡片、图标按钮、保存/取消按钮、工具条布局收口。

## 实现细节
### 1. 背景与卡片层级映射
参考 `agent-ui/components/settings-dialog.tsx` 与多个 `settings/*-panel.tsx`，当前项目建议映射为：
```css
.settings-dialog-content {
  background: rgba(10, 15, 26, 0.92);
}

.settings-surface-card,
.about-panel-card,
.mcp-editor {
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.14);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}
```
说明：
- 目标不是照搬 Tailwind token，而是在现有变量与 rgba 体系里压低亮度、减轻厚重阴影；
- `agents-panel`、`skills-panel`、MCP 列表态与 about 卡片需要统一到相近卡片语言。

### 2. 编辑/删除按钮统一
保留 JSX 中现有类名，但样式收敛为统一 icon button：
```css
.icon-button.edit-button,
.icon-button.delete-button {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.38);
  color: rgba(226, 232, 240, 0.72);
}

.icon-button.delete-button:hover {
  border-color: rgba(248, 113, 113, 0.35);
  color: rgba(252, 165, 165, 0.94);
}
```

### 3. 保存/取消按钮统一
优先合并以下语义：
- 主操作：`.save-button`, `.primary-button`
- 次操作：`.cancel-button`, `.ghost-button`

建议统一方向：
```css
.save-button,
.primary-button {
  min-height: 32px;
  padding: 0 14px;
  border-radius: 8px;
}

.cancel-button,
.ghost-button {
  min-height: 32px;
  padding: 0 14px;
  border-radius: 8px;
}
```
如果现有按钮已被多个页面共享，应只调整视觉，不改变 disabled、loading 和 click handler 行为。

### 4. 删除目录文本显示
当前目录文案渲染大致为：
```tsx
{skillsDirectory ? <span className="skills-directory">目录: {skillsDirectory}</span> : null}
```
和：
```tsx
{agentsDirectory ? <span className="skills-directory">目录: {agentsDirectory}</span> : <span className="skills-directory">目录未加载</span>}
```
本轮直接删除这些 JSX 片段，保留工具栏中的“打开目录”按钮与“创建”按钮。

## 边界条件与异常处理
- 删除目录文本后，不应影响“打开目录”按钮的启用状态与点击行为；
- 若目录 state 变量不再显示但仍用于按钮禁用或错误提示，则保留其状态流；
- 统一按钮风格时，不改变危险操作的确认逻辑，不新增弹窗，不更改删除行为；
- about 背景对齐应保持当前居中与底部版权布局，不回退到上一轮已修正的问题；
- 主面板、编辑器与 about 的收口应局限于设置弹窗区域，不波及聊天主窗口与其他非设置区域。

## 数据流路径
- 本轮不涉及 shared/main/preload 数据接口改动；
- Skills 与 Agents 的目录信息仍可由 renderer 获取，但不再渲染为界面文案；
- 编辑/删除/保存/取消继续沿用现有事件处理链路，仅调整 JSX 与 CSS 展示层。

## 预期结果
- 智能体管理、Skills 管理、MCP 管理和关于页在同一设置弹窗中呈现更接近 `agent-ui` 的统一暗色卡片背景与边框层级；
- 所有编辑/删除图标按钮具备统一尺寸、圆角、边框和 hover 反馈；
- 所有设置页中的保存/取消按钮视觉统一，主次关系清晰；
- Skills 与 Agents 页面不再展示本地存储目录文本，但保留必要操作按钮；
- 整体设置 UI 更接近 `agent-ui`，同时保持当前项目现有功能与数据流稳定。