# 固定设置界面右侧页面标题总结

## 完成内容

- 已将设置界面右侧页面从“整页随外层滚动”调整为“标题固定、具体内容区内部滚动”。
- 已覆盖以下页面的标题区域：
  - 智能体管理
  - Skills 管理
  - MCP 服务管理
  - 通用设置
- 已保留标题右侧操作按钮随标题一起固定，例如“打开目录”“创建智能体”“创建 Skill”“新增服务”。
- 已放弃单纯依赖 `position: sticky` 的方案，避免：
  - 滚动内容从标题上方漏出。
  - 首次滚动时标题跟随轻微位移。
- 已运行 TypeScript 类型检查并通过。

## 问题分析

此前将 `.settings-page-header` 设置为 sticky 后仍存在问题：

1. 红框区域仍能看到滚动内容文本。
2. 首次滚动时标题仍会轻微滚动。

原因是标题位于 `.skills-panel` / `.agents-panel` / `.settings-panel-embedded` 卡片内部，而这些卡片有自身 padding。sticky header 只能覆盖自身盒子区域，无法覆盖卡片顶部 padding 区域，因此滚动内容仍会从卡片顶部 padding 区域漏出。

同时 sticky 依赖滚动吸附临界点，在嵌套滚动和带 padding 的布局中仍可能出现轻微位移。

## 代码变更

### `src/renderer/styles.css`

#### 设置页卡片改为固定高度 flex 容器

```css
.skills-panel,
.agents-panel,
.settings-panel-embedded {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 16px;
}
```

关键位置：

- `src/renderer/styles.css:1296`

#### 具体内容区域改为内部滚动

```css
.skills-content,
.settings-form {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}
```

这样滚动只发生在标题下方的内容区域，标题不参与滚动，也不会被 sticky 吸附临界点影响。

关键位置：

- `src/renderer/styles.css:1307`

#### 页面标题改为普通固定头部区域

```css
.settings-page-header {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  margin: 0 0 12px;
  padding: 0 0 12px;
  border-bottom: 1px solid rgba(120, 139, 164, 0.12);
}
```

关键位置：

- `src/renderer/styles.css:1327`

## 覆盖范围确认

以下页面标题都使用 `.settings-page-header`：

- `src/renderer/features/agents/AgentsPanel.tsx:227`
- `src/renderer/features/skills/SkillsPanel.tsx:164`
- `src/renderer/features/mcp/McpServersPanel.tsx:203`
- `src/renderer/features/settings/SettingsPanel.tsx:36`

其中智能体、Skills、MCP 页面具体内容位于 `.skills-content`；通用设置页面具体内容位于 `.settings-form`。

## 验证结果

已运行：

```bash
npm run typecheck
```

结果：通过。

已确认：

- 本次仅修改 CSS 和 spec 文件。
- 未修改设置页 tab 切换、数据加载、创建、编辑、删除等业务逻辑。
- `.settings-page-header` 不再使用 sticky，避免首次滚动标题轻微位移。
- 具体内容滚动发生在 `.skills-content` / `.settings-form` 内部，避免内容从标题上方漏出。
- 关闭按钮外移样式仍保留。
- 外层滚动容器高度和 padding 未被本次修改，避免回退之前的关闭按钮与滚动条调整。
