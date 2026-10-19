# Assistant 气泡思维链展示任务清单
- [x] Task 1: 为 assistant 思维链展示补充前端状态与视图模型
    - 1.1: 在 `src/renderer/App.tsx` 中新增 reasoning 折叠状态与切换函数
    - 1.2: 在 `src/renderer/features/messages/message-model.ts` 中增加 reasoning 文本判断与预览辅助函数
    - 1.3: 保持现有流式 `reasoning_content` 累加逻辑不变，确认最终快照覆盖后仍可读取 reasoning

- [x] Task 2: 在消息气泡中渲染“思考过程”折叠区
    - 2.1: 扩展 `src/renderer/features/messages/MessageList.tsx` 的 props，接收 reasoning 折叠状态与切换回调
    - 2.2: 在 assistant 气泡头部下方、正文上方插入 reasoning 折叠区结构
    - 2.3: 收起时展示思维链首行预览，展开时复用 `MessageContent` 渲染完整 reasoning markdown
    - 2.4: 保持 assistant 主复制按钮继续复制正文内容，不改变现有复制语义

- [x] Task 3: 补充思维链区域样式并验证展示行为
    - 3.1: 在 `src/renderer/styles.css` 中新增 reasoning 区块、折叠按钮与内容层次样式
    - 3.2: 检查无 reasoning、仅 reasoning、reasoning 很长等边界场景下的显示行为
    - 3.3: 运行 TypeScript 类型检查并修复可能的类型问题
    - 3.4: 运行构建验证 renderer、main、preload 均可正常打包
