# 隐藏思维链期间的执行中气泡任务清单
- [x] Task 1: 收敛 ActivityPanel 的运行态显示条件
    - 1.1: 在 `src/renderer/App.tsx` 中补充基于最新 assistant 消息的派生判断
    - 1.2: 区分运行态与错误态的 ActivityPanel 显示条件
    - 1.3: 确保 assistant 一旦开始显示 reasoning 或正文，底部“执行中”气泡立即隐藏
    - 1.4: 保持工具确认面板与错误态面板的现有优先级

- [x] Task 2: 对齐消息区展示语义并验证边界行为
    - 2.1: 复核 `src/renderer/features/messages/MessageList.tsx` 中 reasoning 气泡与正文气泡的切换条件
    - 2.2: 确保新条件不会被历史 assistant 消息误触发
    - 2.3: 验证“无流式内容 -> reasoning -> 正文 -> 完成/失败”各阶段展示结果一致

- [x] Task 3: 运行构建校验并同步结果
    - 3.1: 执行 `npm run typecheck`
    - 3.2: 执行 `npm run build`
    - 3.3: 如有失败，修复后重新校验并同步最终结果
