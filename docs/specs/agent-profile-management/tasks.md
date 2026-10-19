# 智能体功能实施任务计划
- [x] Task 1: 建立智能体本地存储与 IPC 能力
    - 1.1: 新增 `src/shared/agent-profile.ts`，定义智能体列表、详情、创建、更新等共享类型
    - 1.2: 扩展 `src/shared/contracts.ts`，补充智能体管理 API 类型定义
    - 1.3: 新增 `src/main/agent-profiles-service.ts`，实现本地目录扫描、加载、创建、更新、删除与打开目录能力
    - 1.4: 新增 `src/main/agent-profile-handlers.ts`，注册智能体相关 IPC handlers
    - 1.5: 扩展 `src/preload/index.ts`，向 renderer 暴露智能体 CRUD 与目录操作接口
    - 1.6: 修改 `src/main/index.ts`，在应用启动时加载智能体并注册 handlers

- [x] Task 2: 实现智能体管理弹窗与编辑界面
    - 2.1: 新增 `src/renderer/features/agents/AgentsPanel.tsx`，实现智能体列表加载、刷新、创建、编辑、删除入口
    - 2.2: 新增 `src/renderer/features/agents/AgentEditor.tsx`，实现标题编辑、主体内容编辑、保存与取消交互
    - 2.3: 在弹窗中处理空列表、加载中、保存失败、删除确认等状态反馈
    - 2.4: 在智能体管理界面打开时自动读取本地已保存智能体并按列表展示

- [x] Task 3: 改造主界面以支持智能体选择与展示
    - 3.1: 修改 `src/renderer/App.tsx`，加载智能体列表并维护 `selectedAgentId`、智能体弹窗显示状态
    - 3.2: 在下拉菜单中新增“智能体”项，点击后打开智能体管理弹窗
    - 3.3: 将左侧边栏“智能体”区域改为动态列表，展示本地智能体标题
    - 3.4: 增加“默认模式/无智能体”固定项，并处理选中高亮与删除后回退逻辑
    - 3.5: 修改 `src/renderer/styles.css`，补充智能体列表、选中态、弹窗布局与编辑器样式

- [x] Task 4: 接入发送链路中的智能体预置提示词注入
    - 4.1: 扩展 `src/shared/agent.ts` 中的 `AgentRunInput`，支持传递选中智能体标识
    - 4.2: 修改 `src/renderer/App.tsx`，发送消息时将 `selectedAgentId` 一并传给 `runAgent`
    - 4.3: 修改 `src/main/agent-service.ts`，在每次请求构造消息时按选中智能体注入 `system` message
    - 4.4: 确保智能体正文仅参与模型请求，不写入前端展示消息列表与会话历史 UI
    - 4.5: 处理智能体不存在、内容为空或切换智能体后的兼容逻辑，并记录必要日志

- [x] Task 5: 完成联调验证与任务收尾
    - 5.1: 检查智能体创建、编辑、删除后边栏与弹窗列表是否同步更新
    - 5.2: 检查选择智能体后发送消息时，UI 仅显示用户输入而模型请求包含智能体预置内容
    - 5.3: 检查“默认模式/无智能体”下发送行为不注入额外提示词
    - 5.4: 修正联调中发现的类型、状态或样式问题，并保持 `tasks.md` 勾选状态及时更新
