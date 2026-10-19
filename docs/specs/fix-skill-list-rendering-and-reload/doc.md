# 修复 Skills 管理列表中的名称显示与目录扫描问题

## 背景
用户反馈 Skills 管理面板存在三个问题：
1. 列表中的 skill 名称显示不完整，例如目录名为 `agent-browser-clawdbot` 的 skill，在列表中仅显示为 `agent-browser`。
2. skills 目录中的 `a-stock-analysis` 没有出现在列表中。
3. 点击 skill 编辑面板外的其它区域时，skill 编辑面板会自动关闭。

当前项目是 Electron + React + TypeScript 桌面应用，Skills 管理面板通过 Electron IPC 从主进程读取本地 skills 目录中的 `SKILL.md`，并在渲染进程中展示。

## 现状分析

### 现有数据流
1. 渲染层 `src/renderer/features/skills/SkillsPanel.tsx` 在挂载时调用 `window.desktopApp.listSkills()` 加载一次列表。
2. IPC `skill:list` 在 `src/main/skill-handlers.ts` 中注册，直接返回 `userSkillsService.getSkillListItems()`。
3. `src/main/user-skills-service.ts` 中 `getSkillListItems()` 返回的 `name` 字段来自 `skill.metadata.name`，`directoryName` 单独保存目录名。
4. 列表 UI 当前显示的是 `skill.name`，并未显示 `skill.directoryName`。
5. skills 目录扫描依赖 `scanAndLoadSkills()` / `reloadSkills()`，但前端面板初始化与“打开目录”后都没有主动调用 `reloadSkills()`。

### 已确认根因

#### 问题 1：名称显示不全
这不是 CSS 截断问题，而是字段选择问题。
- `SkillsPanel.tsx` 中列表标题使用 `skill.name` 渲染。
- `skill.name` 对应 YAML frontmatter 中的 `name` 字段，而不是目录名。
- 因此当目录名为 `agent-browser-clawdbot`、但 `SKILL.md` 中 `name: agent-browser` 时，列表只会显示 `agent-browser`。

#### 问题 2：目录中的 skill 未显示
高概率根因是目录变更后未重新扫描。
- `SkillsPanel.tsx` 初次加载只调用 `listSkills()`，不会触发 `reloadSkills()`。
- 后端虽然提供 `skill:reload` IPC，但前端当前没有使用。
- 因此用户如果手动在 skills 目录中新增 `a-stock-analysis`，该 skill 在应用启动后新增时不会自动进入内存列表。

另有几个边界条件也可能导致目录不显示：
- 缺少 `SKILL.md`
- `SKILL.md` 缺少 YAML frontmatter
- 缺少 `name` / `description`
- `metadata.name` 不符合 `^[a-z][a-z0-9-]{0,63}$`
- 与已有 skill 的 `metadata.name` 冲突

## 目标
1. 维持当前 skill 名称展示逻辑，不调整 `skill.name` 与目录名的显示方式。
2. Skills 面板打开时应先触发 reload，再获取最新列表，确保手动新增目录可见。
3. 在不引入额外复杂度的前提下，保持现有编辑、删除、创建流程兼容。

## 技术方案

### 方案一：维持当前列表展示不变
对问题 1 不做修改，保留当前行为：
- 列表标题继续显示 `skill.name`
- 不新增目录名展示
- 不调整该区域样式

这意味着当目录名与 frontmatter 中的 `name` 不一致时，列表仍以 `name` 作为展示值。

### 方案二：面板加载时主动重新扫描 skills 目录
修改 `src/renderer/features/skills/SkillsPanel.tsx`：
- 将当前 `loadSkills()` 改为“先 reload，再 list”。
- 失败时给出错误提示，但仍尽量避免阻塞 UI。

建议实现方式：
```tsx
async function loadSkills() {
  setLoading(true);
  try {
    const reloadResult = await window.desktopApp.reloadSkills();
    if (!reloadResult.ok) {
      throw new Error(reloadResult.error ?? '重新加载 Skills 失败');
    }

    const result = await window.desktopApp.listSkills();
    setSkills(result);
  } catch (error) {
    showMessage('error', '加载 Skills 列表失败');
  } finally {
    setLoading(false);
  }
}
```

这样用户打开 Skills 面板时，手动新增的 `a-stock-analysis` 会在最新扫描后进入列表。

### 方案三：保留现有后端接口，不扩展数据协议
当前共享类型 `SkillListItem` 已包含 `directoryName` 和 `directoryPath`，但本次不消费这些字段做展示调整。
因此本次不修改：
- `src/shared/skill-contracts.ts`
- `src/main/skill-handlers.ts`
- `src/main/user-skills-service.ts` 的接口结构
- `src/renderer/styles.css`

本次仅在渲染层调用已有 `reloadSkills()`，不改列表呈现。
## 影响文件

### 1. `e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx`
**修改类型**：逻辑调整

**涉及函数**：
- `loadSkills()`：改为先 reload 再 list

**修改目的**：
- 确保每次打开面板能看到最新目录内容
- 解决手动新增 skill 目录后列表不更新的问题

### 2. `e:\other-code\desktop-tools\.comate\specs\fix-skill-list-rendering-and-reload\tasks.md`
**修改类型**：后续生成任务计划

### 3. `e:\other-code\desktop-tools\.comate\specs\fix-skill-list-rendering-and-reload\summary.md`
**修改类型**：后续生成实施总结

## 详细实现说明

### Skills 列表刷新逻辑
处理逻辑：
1. 面板挂载时调用 `loadSkills()`。
2. `loadSkills()` 先调用 `window.desktopApp.reloadSkills()`。
3. reload 成功后，再调用 `window.desktopApp.listSkills()`。
4. 将结果写入 `skills` 状态。
5. 若 reload 或 list 失败，展示统一错误消息。

数据流路径：
`SkillsPanel.tsx` → `preload/index.ts reloadSkills` → `main/skill-handlers.ts skill:reload` → `user-skills-service.ts reloadSkills()` → `scanAndLoadSkills()` → `loadSkillFromDirectory()` → 返回列表 → `SkillsPanel.tsx`

### Skills 名称展示逻辑
处理逻辑：
1. 维持当前逻辑，列表标题继续显示 `skill.name`。
2. 不新增目录名展示，不改动当前列表信息层级。

数据流路径：
`user-skills-service.ts getSkillListItems()` → `SkillListItem.name` → `SkillsPanel.tsx` 渲染

## 边界条件与异常处理
1. **reload 失败**：
   - 不崩溃
   - 显示“加载 Skills 列表失败”提示
2. **目录中存在无效 skill**：
   - 后端继续按现有规则跳过无效项
   - 前端不做额外兼容逻辑
3. **目录名与 skill 名称不一致**：
   - 维持现状，列表仍显示 frontmatter 中的 `name`
4. **用户刚创建/删除/更新 skill**：
   - 当前保存和删除流程已经调用 `loadSkills()`，改造后会自动重新扫描并获取最新状态
5. **名称冲突或 YAML 非法**：
   - 保持后端现有校验规则，不在本次扩大改动范围

## 预期结果
1. 手动加入 skills 目录的 `a-stock-analysis` 在打开 Skills 面板后可以被重新扫描并显示出来，前提是其 `SKILL.md` 内容合法。
2. 不影响当前 skill 名称展示方式，以及创建、编辑、删除能力。
3. 改动范围局限于渲染层刷新逻辑，风险较低。

## 不纳入本次范围
1. 不改变 skill 的主标识规则，仍以 frontmatter `name` 为逻辑名称。
2. 不实现文件系统实时监听。
3. 不改变后端对 skill 名称冲突和 YAML 校验的处理方式。
4. 不新增复杂筛选、排序或搜索功能。