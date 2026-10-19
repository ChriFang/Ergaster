# 修复 AgentEditor 校验错误提示不可见总结

## 完成内容

- 已增强 `AgentEditor` 前端校验错误展示逻辑。
- 已补齐 `.skills-message` 和 `.skills-message-error` 样式。
- 已完成 TypeScript 类型检查验证。

## 代码变更

### `src/renderer/features/agents/AgentEditor.tsx`

- 引入 `useRef`。
- 新增 `errorRef`，用于定位错误提示 DOM。
- 新增 `showValidationError(message: string)`，统一处理校验失败：
  - 设置错误文案。
  - 在下一帧滚动到错误提示区域。
- 将名称、描述、模型、系统提示词的校验失败分支从直接 `setError(...)` 改为调用 `showValidationError(...)`。
- 为错误提示 DOM 增加 `ref` 和 `role="alert"`。

关键位置：

- `src/renderer/features/agents/AgentEditor.tsx:2`
- `src/renderer/features/agents/AgentEditor.tsx:44`
- `src/renderer/features/agents/AgentEditor.tsx:62`
- `src/renderer/features/agents/AgentEditor.tsx:75`
- `src/renderer/features/agents/AgentEditor.tsx:134`

### `src/renderer/styles.css`

- 新增 `.skills-message` 基础消息盒样式。
- 增强 `.skills-message-error` 的错误态文字色和背景色。
- 保留并复用原有错误边框色。

关键位置：

- `src/renderer/styles.css:604`
- `src/renderer/styles.css:618`

## 验证结果

已运行：

```bash
npm run typecheck
```

结果：通过。

## 修复效果

- 当描述为空时，`AgentEditor.tsx` 中对应校验会显示“请输入智能体描述。”。
- 当用户在底部点击保存时，页面会自动滚动到错误提示附近，避免提示出现在视口外。
- 名称、模型、系统提示词的必填校验也复用同一展示逻辑。
