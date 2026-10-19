# 参照 agent-ui 迁移设置与管理界面

## 背景与目标
当前 `desktop-tools` 主会话区已基本完成向 `agent-ui` 的视觉迁移，但设置弹窗及其下属的智能体、Skills、MCP、通用设置、关于页仍保留较重的旧式管理界面结构：
- 设置壳层没有统一的右上角关闭图标；
- 左侧 tab 缺少图标与更明确的选中态；
- 多个子页面仍各自保留“关闭”文本按钮；
- 智能体、Skills、MCP 列表信息密度和操作图标化程度不足；
- 智能体与 Skills 的本地数据结构也还不足以支撑更完整的编辑表单。

本轮目标是以 `agent-ui` 的设置/管理界面为视觉参考，对设置弹窗整体与五个页签进行系统迁移，并在必要范围内扩展本地数据结构，使智能体与 Skills UI 能支撑名称、描述、启用状态、关联项等展示与编辑需求。

## 需求拆解与处理逻辑
### 设置窗口整体
- 保持当前应用内 modal 形态，但让设置壳层在不同 tab 下保持统一固定尺寸，不因内容切换而显著改变视觉高度结构。
- 在设置壳层右上角增加统一 `X` 图标关闭按钮，替代各子页中的“关闭”按钮。
- 左侧 tab 前增加图标，并为激活态提供更接近 `agent-ui` 的背景色与文字色。
- 设置导航整体背景、右侧内容背景与当前已迁移的黑/青主题保持统一，向 `agent-ui` 的更简洁双栏设置风格靠拢。
- 删除导航标题下方“统一管理智能体、Skills、MCP 与应用配置”描述文案。

### 智能体管理
- 列表页增加标题下描述，将“创建智能体”移到页头右上角，移除当前“打开目录”“关闭”按钮。
- 智能体列表项前增加图标，并调整为三行信息：
  1. 标题
  2. 概要描述
  3. 模型、Skills 数量、MCP 数量
- 编辑/删除改为图标按钮。
- 编辑页扩展为结构化表单：名称、描述、模型、头像颜色、系统提示词、关联 Skills、关联 MCP 服务。
- 关联 Skills / MCP 使用可快速选中与取消的按钮式列表，不要求本轮落地真实执行逻辑中的 Skills 关联消费，但要完整支持 UI 编辑与存储。

### Skills 管理
- 列表页增加标题下描述。
- 顶部右侧保留“打开目录”，并增加与之同级样式一致的“创建 skill”；移除“关闭”。
- 每个 skill 显示标题和概要描述，不显示额外标签；编辑/删除改为图标按钮；新增启用/停用的开关图标按钮，本轮先做 UI 与本地状态存储。
- 编辑页继续保留大文本编辑框，但补充 skill 名称、概要描述、启用状态等结构化字段，最终仍可映射回 `SKILL.md` 的 frontmatter + markdown 内容。

### MCP 服务管理
- 列表页增加标题下描述。
- 顶部右侧放置“新增服务”，移除“关闭”；保留“默认模式 MCP”入口，但样式需与整体协调。
- 列表项展示名称，编辑/删除改为图标按钮，新增启用/停用开关按钮。
- 编辑页保留现有字段（名称、命令、参数、环境变量、禁用状态），但整体表单和按钮布局参考 `agent-ui` 的轻量卡片与表单组织方式。
- 默认 MCP 绑定逻辑不改，仅调整其视觉样式与层级。

### 通用设置
- 页面标题改为“通用设置”，描述改为“配置模型、连接与本地目录权限”。
- 保留现有配置项与提交流程，主要做头部文案、表单布局与输入视觉迁移。
- API Key 可见图标由当前图片资源切换为与 `agent-ui` 更一致的图标按钮样式。

### 关于页
- 重构为独立的 about 组件或独立渲染块。
- 展示 logo、应用名称、版本、简要功能描述和版权。
- 不再展示运行环境、文档、开源仓库等内容。

## 架构与技术方案
### UI 结构层
- 主要修改：
  - `src/renderer/features/layout/SettingsDialogShell.tsx`
  - `src/renderer/App.tsx`
  - `src/renderer/styles.css`
- 将 `SettingsDialogShell` 的 `TAB_ITEMS` 从纯文本扩展为包含图标的配置对象。
- 在壳层级统一注入关闭图标按钮，移除各子页内部“关闭”按钮，以避免重复交互入口。
- About 区块从 `App.tsx` 内联 JSX 提升为更清晰的独立渲染结构（可内联，也可抽组件；以最小改动且保持职责清晰为准）。

### 智能体数据结构扩展
- 需要扩展 `src/shared/agent-profile.ts` 与 `src/main/agent-profiles-service.ts` 的元数据：
  - `description`
  - `model`
  - `avatarColor`
  - `skillNames`
  - 现有 `mcp.enabledServerNames`
- 为保证现有本地 agent 目录向后兼容，主进程读取 `agent.json` 时需要提供默认值回填。
- `AgentEditor.tsx` 从“标题 + 主体内容 + MCP 选择”扩展为完整表单；`AgentsPanel.tsx` 同步调整保存 payload。
- Skills 关联本轮先完成存储与 UI，不强行接入运行时执行链路。

### Skills 数据结构与编辑方式扩展
- 当前 skill 的真实来源是 `SKILL.md` frontmatter + markdown 正文。
- 需要扩展前端编辑器交互，但仍保持最终落盘为 `SKILL.md`：
  - `name`
  - `description`
  - `enabled`
  - `content`
- 需要同步调整：
  - `src/shared/contracts.ts` 中 `SkillDetail`
  - `src/shared/skill-contracts.ts` 中列表项字段（已含 `enabled`）
  - `src/shared/user-skills.ts` 中 frontmatter 类型
  - `src/main/user-skills-service.ts` 的解析、构建、创建和更新逻辑
  - `src/renderer/features/skills/SkillEditor.tsx` / `SkillsPanel.tsx`
- 启用/停用状态本轮优先做本地元数据保存与列表 UI 反馈；如运行时尚未消费该字段，不额外接执行逻辑。

### MCP 列表与编辑 UI 迁移
- 主要调整 `src/renderer/features/mcp/McpServersPanel.tsx` 与共享样式，不改变现有 `disabled` 数据结构和默认绑定 API。
- 列表新增启用/禁用切换按钮时，直接复用现有 `disabled` 字段进行保存。

### 图标与视觉体系
- 当前仓库已引入 `lucide-react` 并用于侧边栏/消息头像，可继续用于设置页 tab 图标、关闭图标、编辑/删除图标、可见性图标、开关图标、关于页 logo。
- 统一延续当前黑底、青色强调的主题 token，不再回退到旧的蓝灰卡片风格。

## 影响文件
### 直接修改
- `e:\other-code\desktop-tools\src\renderer\features\layout\SettingsDialogShell.tsx`
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
- `e:\other-code\desktop-tools\src\renderer\styles.css`
- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentEditor.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\skills\SkillEditor.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\mcp\McpServersPanel.tsx`
- `e:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx`
- `e:\other-code\desktop-tools\src\shared\agent-profile.ts`
- `e:\other-code\desktop-tools\src\shared\contracts.ts`
- `e:\other-code\desktop-tools\src\shared\skill-contracts.ts`
- `e:\other-code\desktop-tools\src\shared\user-skills.ts`
- `e:\other-code\desktop-tools\src\main\agent-profiles-service.ts`
- `e:\other-code\desktop-tools\src\main\user-skills-service.ts`

### 可能联动修改
- `e:\other-code\desktop-tools\src\preload\index.ts`
- `e:\other-code\desktop-tools\src\main\index.ts`
- `e:\other-code\desktop-tools\src\renderer\features\settings\settings-model.ts`
- 若发现 API 合同需要同步传递新增字段，则相应的 IPC contract 代码也需跟进。

### 规格产物
- `e:\other-code\desktop-tools\.comate\specs\migrate-settings-ui-toward-agent-ui\doc.md`
- `e:\other-code\desktop-tools\.comate\specs\migrate-settings-ui-toward-agent-ui\tasks.md`
- `e:\other-code\desktop-tools\.comate\specs\migrate-settings-ui-toward-agent-ui\summary.md`

## 实现细节
### 设置壳层
- 统一壳层尺寸建议直接由 `.settings-dialog-shell` 控制，例如固定宽高上限，而不是让不同 tab 由内容撑开。
- 统一关闭按钮应位于壳层右上角，并通过 `onClose` 直接关闭整个设置弹窗。
- 左侧 tab 配置可扩展成：
```ts
const TAB_ITEMS = [
  { id: 'agents', label: '智能体管理', icon: Bot },
  { id: 'skills', label: 'Skills 管理', icon: Wrench },
  ...
];
```

### 智能体元数据示意
`agent.json` 可扩展为：
```json
{
  "id": "meeting-assistant",
  "title": "会议纪要助手",
  "description": "擅长整理会议讨论要点与行动项",
  "model": "deepseek-v4-pro",
  "avatarColor": "cyan",
  "skillNames": ["meeting-summary", "action-items"],
  "mcp": {
    "enabledServerNames": ["filesystem"]
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```
- `content` 仍继续写入 `AGENT.md`，对应“系统提示词”。

### Skill 编辑策略
- 继续保留大文本编辑框用于 markdown 正文；
- 新增名称、描述、启用状态字段作为结构化表单；
- 保存时由前端或主进程重建 frontmatter，再写回 `SKILL.md`。

### About 页信息
- 可复用现有品牌 `Hexagon` 图标或与侧边栏一致的品牌块。
- About 内容建议控制为：logo / app 名称 / 版本 / 一段功能简介 / copyright。

## 数据流与调用链
- 设置弹窗打开与 tab 切换状态仍由 `useSettingsState` + `App.tsx` 控制。
- 智能体增改查删仍通过 `window.desktopApp.createAgent/updateAgent/...` 链路，但请求/响应类型要扩展。
- Skills 增改查删仍通过 `window.desktopApp.createSkill/updateSkill/...`，但 `SkillDetail` 与 markdown 构建逻辑需同步扩展。
- MCP 仍通过既有 `saveMcpServer` / `saveDefaultAgentMcpBinding` 工作。

## 边界条件与异常处理
- 旧版 `agent.json` 缺少新增字段时必须能够正常读取并以默认值渲染。
- 旧版 `SKILL.md` 缺少 `enabled` 字段时应默认视为启用。
- Skills 与智能体的“关联”本轮只保证 UI 编辑和持久化，不误导为已经接入真实执行逻辑。
- 设置弹窗固定尺寸后，所有页签内容必须通过内部滚动承载，避免内容溢出或遮挡保存按钮。
- 去掉子页“关闭”按钮后，用户仍能通过统一 `X`、遮罩点击和原有关闭逻辑退出。

## 预期结果
- 设置弹窗整体视觉、交互结构和主题更接近 `agent-ui`。
- 五个页签的列表、编辑表单和头部层级更加统一、紧凑、图标化。
- 智能体与 Skills 数据结构可支撑新的列表展示和编辑需求。
- `npm run typecheck` 与 `npm run build` 继续通过。