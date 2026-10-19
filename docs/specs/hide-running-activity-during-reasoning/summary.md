# 隐藏思维链期间的执行中气泡总结

## 完成内容
- 在 `src/renderer/App.tsx` 中新增最近一次流式 assistant 消息识别逻辑，仅检查最后一条用户消息之后的 assistant 流式展示状态，避免历史 assistant 消息误触发运行态隐藏
- 基于该派生结果收紧 `ActivityPanel` 的运行态显示条件：当 assistant 已开始展示 reasoning 或正文时，底部“执行中”气泡不再显示
- 保持错误态卡片与工具确认卡片的现有优先级，不影响失败提示和工具确认流程
- 复核 `src/renderer/features/messages/MessageList.tsx` 的 reasoning / 正文切换条件，确认无需额外修改即可与新的运行态条件对齐

## 关键变更
### `e:\other-code\desktop-tools\src\renderer\App.tsx`
- 新增 `getLatestStreamingAssistantMessage(messages)`，先定位最后一条用户消息，再向后回溯最近的 assistant 流式可见消息
- 新增 `hasVisibleStreamingAssistantState`
- 新增 `showRunningActivityPanel` 与 `showErrorActivityPanel`
- 调整 `ActivityPanel` 渲染逻辑，只在真正需要显示运行态或错误态时渲染

## 校验结果
- `npm run typecheck`：通过
- `npm run build`：通过

## 最终效果
- 请求发出但 assistant 尚未返回任何可见内容时，底部继续显示“执行中...”
- assistant 开始显示“思考过程”气泡后，底部“执行中...”立即隐藏
- assistant 正文开始流式显示后，底部“执行中...”保持隐藏
- 失败场景仍会显示错误卡片
