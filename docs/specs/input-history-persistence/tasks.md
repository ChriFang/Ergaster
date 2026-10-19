# 输入记录文件持久化实施任务计划
- [x] Task 1: 建立输入记录文件持久化与 IPC 能力
    - 1.1: 新增 `src/main/input-history-service.ts`，实现输入记录目录创建、文件读取、追加写入与 100 条上限控制
    - 1.2: 在 `src/main/input-history-service.ts` 中将保存路径固定为 `AppData/Roaming/desktop-tools/chat-history`
    - 1.3: 扩展 `src/shared/contracts.ts`，补充 `getInputHistory` 与 `appendInputHistory` API 类型定义
    - 1.4: 扩展 `src/preload/index.ts`，向 renderer 暴露输入记录读取与追加接口
    - 1.5: 修改 `src/main/index.ts`，注册输入记录相关 IPC handlers

- [x] Task 2: 改造前端初始化与发送流程以接入持久化输入记录
    - 2.1: 修改 `src/renderer/App.tsx`，在程序初始化时调用 `getInputHistory()` 并回填左侧栏数据
    - 2.2: 修改 `src/renderer/App.tsx`，在发送消息后异步调用 `appendInputHistory(prompt)` 将输入记录写入文件
    - 2.3: 保持前端即时更新输入记录列表，并在主进程返回最新历史后用返回值校正本地状态
    - 2.4: 确保点击历史记录仍只回填输入框，不改变现有交互逻辑

- [x] Task 3: 完成边界处理与联调验证
    - 3.1: 处理历史文件不存在、目录不存在、JSON 损坏或空内容等异常场景，确保不阻断程序启动与聊天发送
    - 3.2: 验证输入记录最多只保留 100 条，且重启应用后仍能正确加载并展示
    - 3.3: 运行类型检查并修正联调中发现的问题
    - 3.4: 完成后及时更新 `tasks.md` 勾选状态，并为总结文件准备结果说明
