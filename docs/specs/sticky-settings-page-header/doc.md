# 固定设置界面右侧页面标题

## 需求场景

用户反馈设置界面右侧页面标题会跟随滚动条滚动，例如“智能体管理”标题会随内容滚走，视觉效果不好。期望这些右侧管理页面的顶部标题在内容滚动时保持在顶部，不随滚动条一起滚动。

典型页面包括：

- 智能体管理：`智能体管理`
- Skills 管理：`Skills 管理`
- MCP 服务管理：`MCP 服务管理`
- 通用设置：`通用设置`

## 当前实现分析

### 设置弹窗滚动结构

文件：`e:\other-code\desktop-tools\src\renderer\features\layout\SettingsDialogShell.tsx`

当前右侧内容全部包在滚动容器内：

```tsx
<section className="settings-dialog-content">
  <div className="settings-dialog-content-scroll">{renderContent(activeTab)}</div>
</section>
```

因此 `renderContent(activeTab)` 返回的页面整体都会随 `.settings-dialog-content-scroll` 滚动。

### 页面标题位置

#### 智能体管理

文件：`e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`

```tsx
<div className="skills-header settings-page-header">
  <div>
    <h2>智能体管理</h2>
    <p className="settings-description">管理本地智能体资料、系统提示词、关联 Skills 与 MCP 服务。</p>
  </div>
  ...
</div>
```

#### Skills 管理

文件：`e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx`

```tsx
<div className="skills-header settings-page-header">
  <div>
    <h2>Skills 管理</h2>
    <p className="settings-description">管理自定义 Skills 的名称、描述、启用状态与正文内容。</p>
  </div>
  ...
</div>
```

#### MCP 服务管理

文件：`e:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`

```tsx
<div className="skills-header settings-page-header">
  <div>
    <h2>MCP 服务管理</h2>
    <p className="settings-description">统一管理 MCP 服务的启用状态、命令参数与默认模式绑定。</p>
  </div>
  ...
</div>
```

#### 通用设置

文件：`e:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx`

```tsx
<div className="settings-header settings-page-header">
  <div>
    <h3>通用设置</h3>
    <p className="settings-description">配置模型、连接与本地目录权限</p>
  </div>
</div>
```

这些标题都带有公共类 `.settings-page-header`，适合通过 CSS 统一固定。

## 技术方案

采用 CSS `position: sticky` 的最小改动方案，不拆分组件结构，并修正首次 sticky 方案的两个问题：

- 滚动时具体设置内容会显示到最顶部，透到标题区域上方。
- 开始滚动时标题会轻微抖动。

问题原因：首次方案使用 `margin: -12px -24px 4px` 将 sticky header 拉出滚动容器 padding，并使用底部透明的渐变背景。负 margin 会让 sticky 的吸附临界点不稳定，容易在刚开始滚动时出现轻微跳动；透明渐变底部会让滚动内容在标题区域下方/顶部露出。

进一步修正方案：

1. 不再依赖 `.settings-page-header` 的 sticky 定位来解决标题固定。当前标题位于 `.skills-panel` / `.agents-panel` 卡片内部，而卡片本身有 `padding: 16px`。即使 header sticky，卡片顶部 padding 区域仍不是 header 覆盖范围，滚动内容会从这段区域漏出。
2. 将设置页卡片调整为垂直 flex 容器，并占满右侧滚动视口高度：

```css
.skills-panel,
.agents-panel,
.settings-panel-embedded {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
```

3. 让标题区域成为普通非滚动内容，不再使用 sticky：

```css
.settings-page-header {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  margin: 0 0 12px;
  padding: 0 0 12px;
  background: transparent;
  border-bottom: 1px solid rgba(120, 139, 164, 0.12);
}
```

4. 将具体内容区改为卡片内部的滚动区域：

```css
.skills-content,
.settings-form {
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.skills-content {
  flex: 1;
}

.settings-form {
  flex: 1;
}
```

5. 保持外层 `.settings-dialog-content-scroll` 的滚动能力作为兜底，但目标页面自身会通过内部 flex + overflow 承担主体滚动。这样标题不参与滚动，也不会出现 sticky 吸附临界点导致的轻微位移。
6. 保持关闭按钮外移和滚动条长度调整不变。

## 影响文件

### `e:\other-code\desktop-tools\src\renderer\styles.css`

修改类型：新增/调整公共设置页头部样式。

涉及选择器：

- `.settings-page-header`

预计改动：

```css
.settings-page-header {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: -12px -24px 0;
  padding: 12px 24px 14px;
  background: linear-gradient(180deg, rgba(9, 14, 22, 0.98) 0%, rgba(9, 14, 22, 0.92) 78%, rgba(9, 14, 22, 0) 100%);
  backdrop-filter: blur(10px);
}
```

### 只读确认文件

以下文件仅用于确认标题结构，默认不修改：

- `e:\other-code\desktop-tools\src\renderer\features\layout\SettingsDialogShell.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx`

## 边界条件和异常处理

- 不改变设置弹窗 tab 切换逻辑。
- 不改变各管理页面的数据加载、创建、编辑、删除逻辑。
- 不改变右上角关闭按钮外移方案。
- 不改变滚动容器 `.settings-dialog-content-scroll` 的高度和 padding，避免重新引入之前的留白问题。
- sticky header 会固定整行标题区域，包括右侧操作按钮，例如“打开目录”“创建智能体”。这是预期行为，因为按钮与标题同属页面头部操作区。
- 若某个页面没有 `.settings-page-header`，不会受到影响；“关于”页面当前没有该类，不在本次范围内。

## 数据流路径

本次没有数据流变更，仅调整 CSS：

1. `SettingsDialogShell` 渲染 `.settings-dialog-content-scroll`。
2. 当前 tab 页面渲染 `.settings-page-header`。
3. 用户滚动 `.settings-dialog-content-scroll`。
4. `.settings-page-header` 因 `position: sticky` 固定在滚动容器顶部。
5. 标题下方内容继续正常滚动。

## 预期结果

- 设置界面右侧“智能体管理”等标题不再随滚动条滚出视口。
- 标题和右侧操作按钮保持在右侧内容顶部。
- 内容列表、编辑表单仍可正常滚动。
- 关闭按钮不覆盖滚动条的问题不回退。
- TypeScript 类型检查通过。
