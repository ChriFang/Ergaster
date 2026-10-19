# 收起态隐藏思维链预览修复任务清单
- [x] Task 1: 调整 assistant reasoning 折叠区的收起态渲染
    - 1.1: 修改 `src/renderer/features/messages/MessageList.tsx`，移除收起态的 reasoning 预览文本节点
    - 1.2: 保留“思考过程 / 展开 / 收起”按钮，仅在展开态渲染 reasoning 内容容器
    - 1.3: 保持 assistant 正文区与主复制按钮行为不变

- [x] Task 2: 清理不再需要的 reasoning 预览辅助逻辑
    - 2.1: 从 `src/renderer/features/messages/message-model.ts` 中删除 `getReasoningPreviewText`
    - 2.2: 更新 `src/renderer/features/messages/MessageList.tsx` 的 import 与局部变量，移除对 preview 文本的依赖

- [x] Task 3: 校正样式并验证修复结果
    - 3.1: 视实际渲染效果调整 `src/renderer/styles.css` 中 reasoning 区域间距样式
    - 3.2: 验证收起态、展开态、流式更新中三种场景的显示行为
    - 3.3: 运行 TypeScript 类型检查并修复可能的类型问题
    - 3.4: 运行构建验证 renderer、main、preload 均可正常打包
