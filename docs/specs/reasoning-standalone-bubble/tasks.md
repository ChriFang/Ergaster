# 独立思考气泡显示改造任务清单
- [x] Task 1: 调整 assistant 渲染策略为独立思考气泡
    - 1.1: 修改 `src/renderer/features/messages/MessageList.tsx`，将 assistant reasoning 从内嵌块改为独立气泡派生渲染
    - 1.2: 仅在 `reasoning_content` 非空且 `content` 仍为空时显示思考过程气泡
    - 1.3: 正文 `content` 一旦开始显示，即隐藏思考过程气泡并只保留正文 assistant 气泡
    - 1.4: 避免正文为空时渲染空白 assistant 正文气泡

- [x] Task 2: 清理不再需要的 reasoning 折叠状态与样式
    - 2.1: 从 `src/renderer/App.tsx` 中删除 reasoning 折叠状态、切换函数和对应传参
    - 2.2: 从 `src/renderer/features/messages/MessageList.tsx` 中移除 reasoning 折叠交互相关 props 与逻辑
    - 2.3: 清理 `src/renderer/styles.css` 中旧的 reasoning 内嵌块/折叠样式，替换为独立 reasoning 气泡样式

- [x] Task 3: 验证独立思考气泡方案行为
    - 3.1: 检查仅 reasoning、reasoning 转正文、历史 assistant 消息三类场景的显示行为
    - 3.2: 确认工具消息、复制按钮、右键选择与自动滚动能力不受影响
    - 3.3: 运行 TypeScript 类型检查并修复可能的类型问题
    - 3.4: 运行构建验证 renderer、main、preload 均可正常打包
