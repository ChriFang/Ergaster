# 设置界面开关按钮与字体风格迁移

## 需求场景与处理逻辑
本轮迁移聚焦设置弹窗中的两类视觉一致性问题：
- Skills 管理页、MCP 管理页及对应编辑界面中的启用/停用按钮，当前仍是图标按钮或普通按钮，需要向 `agent-ui` 的开关组件风格靠拢；
- 设置界面整体字体风格需要参考 `agent-ui` 项目进行收口。

用户已补充参考工程路径 `E:\other-code\agent-ui`。结合该项目实现可确认：
- `agent-ui` 使用更接近 `Geist Sans` / `Geist Mono` 的无衬线与等宽字体体系；
- `agent-ui` 的开关是紧凑型横向滑块，尺寸较小，圆角完整，选中态为高亮主色底，未选中态为弱对比输入底色，thumb 为独立圆形滑块；
- 在 Skills 与 MCP 列表中，开关本身不带“眼睛”图标，而是直接使用 switch 形态；
- 编辑界面里的启用状态也使用同一套 switch 组件，不再复用普通按钮。

本轮处理原则：
- 只在 renderer 层实现，不调整现有数据流与开关逻辑；
- 抽取一套本地可复用的 switch 样式与轻量结构，避免为单次迁移引入额外外部依赖；
- 技术上保持当前 React + CSS 架构，不直接复制 `agent-ui` 的 Base UI / Tailwind 依赖链；
- 字体迁移优先以 CSS font-family 栈模拟 `agent-ui` 的观感，在当前项目无 Geist 字体资源的前提下采用渐进降级方案。

## 架构与技术方案
实现分为两部分：
1. 开关样式迁移
   - 将 Skills 列表、MCP 列表中的启用按钮，从 `Eye/EyeOff` 图标按钮改为 switch 结构；
   - 将 `SkillEditor.tsx` 与 `McpServersPanel.tsx` 编辑表单内的启用状态按钮，同步替换为相同 switch 结构；
   - 使用统一类名，例如：
     - `settings-switch`
     - `settings-switch-track`
     - `settings-switch-thumb`
     - `settings-switch-label`
     - `settings-switch-row`
   - 保留原有点击逻辑与布尔状态，只修改展示层。
2. 设置界面字体迁移
   - 在 `styles.css` 中为设置弹窗及其子页面定义更贴近 `agent-ui` 的字体栈：
     - 主体优先 `Geist`, `Inter`, `Segoe UI`, `system-ui`, `sans-serif`
     - 等宽内容优先 `Geist Mono`, `JetBrains Mono`, `Cascadia Code`, `Consolas`, `monospace`
   - 重点收口以下区域：
     - 设置弹窗导航
     - 页面标题/描述
     - 表单标签/输入框/说明文案
     - Skills 与 MCP 列表项
   - 不改变聊天主界面字体，避免扩大本轮影响面。

## 影响文件
- 修改 `e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx`
  - 将 Skills 列表启用按钮替换为 switch 结构。
- 修改 `e:\other-code\desktop-tools\src\renderer\features\skills\SkillEditor.tsx`
  - 将 Skill 编辑界面启用状态按钮替换为 switch 结构。
- 修改 `e:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`
  - 将 MCP 列表启用按钮及编辑界面状态按钮替换为 switch 结构。
- 修改 `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 增加 switch 样式与设置弹窗字体栈样式。

## 实现细节
参考 `agent-ui/components/ui/switch.tsx:15`，当前项目不引入 Base UI，而是使用 button + span 组合模拟：
```tsx
<button
  type="button"
  className={`settings-switch${enabled ? ' settings-switch-checked' : ''}`}
  aria-pressed={enabled}
>
  <span className="settings-switch-track">
    <span className="settings-switch-thumb" />
  </span>
</button>
```

对于带文案的编辑界面，采用：
```tsx
<div className="settings-switch-row">
  <span className="settings-switch-label">已启用</span>
  <button ... />
</div>
```

字体栈建议：
```css
.settings-dialog-shell,
.settings-dialog-shell button,
.settings-dialog-shell input,
.settings-dialog-shell textarea,
.settings-dialog-shell select {
  font-family: 'Geist', 'Inter', 'Segoe UI', system-ui, sans-serif;
}

.settings-dialog-shell code,
.settings-dialog-shell .skills-directory,
.settings-dialog-shell .agent-settings-meta-row,
.settings-dialog-shell .about-panel-version {
  font-family: 'Geist Mono', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
}
```

## 边界条件与异常处理
- 仅迁移设置弹窗范围内的字体，不波及会话区和侧边栏；
- switch 需要保留禁用态、聚焦态和当前 aria 语义；
- MCP 与 Skill 开关逻辑仍使用现有布尔状态切换，不新增确认步骤；
- 由于当前工程未内置 Geist 字体文件，最终效果采用系统可用字体回退，视觉接近但不强依赖外部资源。

## 数据流路径
- Skills 列表开关：renderer button click → `window.desktopApp.getSkill/updateSkill` → main service
- MCP 列表开关：renderer button click → `window.desktopApp.saveMcpServer` → main service
- 编辑界面开关：仅修改本地组件 state，保存时沿用现有 request payload
- 本轮不涉及 shared contract、IPC 名称或持久化字段调整。

## 预期结果
- Skills 与 MCP 列表中的启用入口改为与 `agent-ui` 观感一致的紧凑型 switch；
- Skill 编辑与 MCP 编辑中的启用状态控件统一为同一套 switch 样式；
- 设置弹窗整体字体更接近 `agent-ui`，标题、说明、表单与列表的文字观感更统一。