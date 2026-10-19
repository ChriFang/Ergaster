# 智能体功能实施总结

## 完成内容
已完成智能体功能的完整落地，覆盖菜单入口、弹窗管理、本地持久化、侧边栏选择与发送链路注入。

### 本地存储与主进程能力
- 新增 `src/shared/agent-profile.ts`，定义智能体列表、详情、创建、更新与操作结果类型。
- 新增 `src/main/agent-profiles-service.ts`，实现智能体目录扫描、加载、创建、更新、删除与目录打开能力。
- 新增 `src/main/agent-profile-handlers.ts`，注册智能体相关 IPC handlers。
- 修改 `src/main/index.ts`，在应用启动时注册智能体 handlers 并扫描本地智能体目录。
- 修改 `src/shared/contracts.ts` 与 `src/preload/index.ts`，向 renderer 暴露智能体管理 API。

### 智能体管理界面
- 新增 `src/renderer/features/agents/AgentsPanel.tsx`，实现智能体列表展示、刷新、创建、编辑、删除、打开目录。
- 新增 `src/renderer/features/agents/AgentEditor.tsx`，实现智能体标题与主体内容编辑。
- 打开智能体管理界面时会主动重扫本地目录并展示最新列表。

### 主界面与交互
- 修改 `src/renderer/App.tsx`：
  - 菜单新增“智能体”入口。
  - 左侧边栏智能体区域改为动态列表。
  - 增加“默认模式”固定项。
  - 支持选中智能体高亮与删除后自动回退。
  - 头部增加当前智能体提示。
- 修改 `src/renderer/styles.css`，补充智能体列表、选中态、弹窗与编辑器样式。

### 发送链路注入
- 修改 `src/shared/agent.ts`，为 `AgentRunInput` 增加 `agentId`。
- 修改 `src/main/agent-service.ts`，在每次请求发送给模型前，根据 `agentId` 查询智能体内容，并以 `system` message 形式注入到请求顶部。
- 注入内容不会写入前端消息列表，聊天 UI 仍只显示用户原始输入与模型回复。

## 联调与校验
- 已执行 `npm run typecheck`，类型检查通过。
- 联调过程中顺手修复了一个已有类型问题：
  - `src/main/user-skills-service.ts` 中 `appendMainLog('WARN', ...)` 与现有日志类型定义不一致，已改为 `ERROR` 以通过当前类型系统。

## 本地存储结构
智能体保存位置使用 Electron `app.getPath('userData')/agents`，每个智能体一个目录，包含：
- `agent.json`：标题与时间等元信息
- `AGENT.md`：智能体正文内容

## 结果说明
现在已支持：
- 从下拉菜单打开智能体管理弹窗
- 打开时扫描并展示本地智能体
- 对智能体进行增/删/改
- 左侧边栏显示智能体标题并选择
- 发送用户提示词时自动附带所选智能体预置提示词
- 聊天 UI 不显示智能体正文
