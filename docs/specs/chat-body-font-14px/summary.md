# 会话正文改为 14px

## 完成情况
- 已在 `e:\other-code\desktop-tools\src\renderer\styles.css` 的 `.message-content` 规则中新增 `font-size: 14px;`。
- 已完成任务清单中的全部顶层任务并更新 `tasks.md` 勾选状态。

## 实际修改
### 样式调整
- 文件：`e:\other-code\desktop-tools\src\renderer\styles.css`
- 结果：会话正文基础字号固定为 14px。

最终规则如下：

```css
.message-content {
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: #e5e7eb;
}
```

## 影响验证
- 普通正文、Markdown 正文、折叠态预览、预格式化正文都复用 `message-content`，因此会统一继承 14px 基础字号。
- `.message-role`、`.message-meta`、`.message-summary` 等非正文元素仍保持各自原有字号规则，未受本次修改影响。
- Markdown 标题 `h1/h2/h3` 仍保留独立字号定义，不会被基础正文 14px 覆盖，这是预期结果。
- 代码块和行内代码样式未做额外改动，保持现有视觉规则。

## 结果
- 会话正文已按要求改为 14px。
- 修改范围保持最小，仅调整了一个现有样式规则。