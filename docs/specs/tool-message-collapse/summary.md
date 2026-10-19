# 工具消息卡片折叠/展开实现总结

## 完成内容
- 在 `src/renderer/App.tsx` 中为每条消息补充了工具消息键生成逻辑，并基于本地状态实现了工具消息独立展开/收起。
- 工具消息默认以折叠状态展示，折叠时仅显示正文第一行预览；展开后恢复原有完整 Markdown / JSON 内容渲染。
- 在工具消息头部加入了“展开 / 收起”按钮，并保持“复制完整消息”逻辑不变。
- 在 `src/renderer/styles.css` 中补充了折叠预览文本、头部操作区、折叠按钮的样式，确保状态标签与切换按钮可同时显示。

## 受影响文件
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
- `e:\other-code\desktop-tools\src\renderer\styles.css`
- `e:\other-code\desktop-tools\.comate\specs\tool-message-collapse\tasks.md`

## 验证结果
- 已运行 `npm run typecheck`，结果通过。
- 已检查本次修改文件的 lint 诊断，未发现问题。

## 实现结果
- 工具消息卡片现在默认折叠，能减少长工具返回内容对聊天区高度的占用。
- 折叠状态下用户仍可快速查看工具角色、执行状态、工具名称、参数摘要及正文首行。
- 展开后完整内容渲染路径保持原实现，不影响复制完整消息与右键复制选中文本等既有交互。