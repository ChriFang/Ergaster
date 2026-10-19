# 设置 UI 标题与关于页排版优化

## 需求场景与处理逻辑
本轮优化聚焦于设置弹窗内的视觉收口，范围限定在现有设置页 renderer 展示层，不调整主进程、共享合同或数据持久化逻辑。

用户希望：
- 去掉智能体管理页标题上方的 `AGENTS` 文案；
- 去掉 Skills 管理页标题上方的 `SKILLS` 文案；
- 去掉 MCP 服务管理页标题上方的 `MCP` 文案；
- 去掉通用设置页标题上方的 `GENERAL` 文案；
- 修正关于页图标与文字未居中导致的视觉不协调问题；
- 将关于页版权声明压到底部，并使用更小字号弱化展示。

处理时保持以下原则：
- 只移除页面主标题上方的 eyebrow 文案，不影响编辑器内部如 `Agent Editor`、`Skill Editor`、`MCP Editor` 等局部辅助标题；
- 关于页继续保留 logo、应用名称、版本与描述信息，但整体改为居中对齐；
- 关于页版权文案放入卡片底部区域，通过 flex 布局让内容区与底部声明形成稳定垂直分层；
- 不额外引入新的组件抽象，直接在现有页面 JSX 和样式中最小修改。

## 架构与技术方案
实现分两部分：
1. JSX 结构清理
   - 在 `AgentsPanel.tsx`、`SkillsPanel.tsx`、`McpServersPanel.tsx`、`SettingsPanel.tsx` 中移除页面标题区顶部的 eyebrow `<p>` 节点；
   - 在 `App.tsx` 的 about 页面结构中，将品牌卡片内容调整为更适合垂直居中的容器层级，必要时为版权区增加独立包裹层。
2. CSS 排版收口
   - 在 `styles.css` 中为 about 卡片增加整体居中、文本居中、内容区垂直对齐样式；
   - 让版权区使用 `margin-top: auto` 压到卡片底部，并降低字号与颜色对比；
   - 保持 logo、标题、版本、描述间距紧凑且居中，避免顶部偏移感。

## 影响文件
- 修改 `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`
  - 移除页面标题区的 eyebrow 文案。
- 修改 `e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx`
  - 移除页面标题区的 eyebrow 文案。
- 修改 `e:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`
  - 移除页面标题区的 eyebrow 文案。
- 修改 `e:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx`
  - 移除页面标题区的 eyebrow 文案。
- 修改 `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - 调整 about 页面卡片的结构层级，使版权可独立贴底。
- 修改 `e:\other-code\desktop-tools\src\renderer\styles.css`
  - 更新 about 区块的对齐、间距、底部版权样式。

## 实现细节
页面标题区从：
```tsx
<div>
  <p className="eyebrow">Agents</p>
  <h2>智能体管理</h2>
  <p className="settings-description">...</p>
</div>
```
调整为：
```tsx
<div>
  <h2>智能体管理</h2>
  <p className="settings-description">...</p>
</div>
```

关于页从当前同层堆叠结构：
```tsx
<div className="about-panel-card about-panel-card-brand">
  <div className="about-panel-logo" />
  <p className="eyebrow">Desktop Tools</p>
  <h3>...</h3>
  <p className="about-panel-version">...</p>
  <p className="about-panel-description">...</p>
  <p className="about-panel-copyright">...</p>
</div>
```
调整为更稳定的上下分层：
```tsx
<div className="about-panel-card about-panel-card-brand">
  <div className="about-panel-main">
    <div className="about-panel-logo" />
    <h3>...</h3>
    <p className="about-panel-version">...</p>
    <p className="about-panel-description">...</p>
  </div>
  <p className="about-panel-copyright">...</p>
</div>
```

建议样式方向：
```css
.about-panel-card-brand {
  align-items: center;
  text-align: center;
}

.about-panel-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
}

.about-panel-copyright {
  margin-top: auto;
  font-size: 12px;
  color: var(--text-muted);
}
```

## 边界条件与异常处理
- 仅移除主页面 eyebrow，不修改编辑器视图内的 eyebrow，避免信息层级全部丢失；
- 如果应用信息尚未加载完成，about 页版本文案仍继续显示 `正在加载应用信息...`，布局不应跳动；
- 小窗口下依然保持 about 内容可见，版权位于底部但不溢出卡片。

## 数据流路径
- 本轮不涉及 IPC、shared contracts、main process 或本地文件结构变更；
- 所有改动均在 renderer JSX 与 CSS 层完成。

## 预期结果
- 四个设置主页面标题区不再显示英文 eyebrow；
- about 页 logo、名称、版本、描述在卡片内水平居中、视觉更稳定；
- 版权声明位于卡片底部，字号更小、存在感更弱但清晰可见。