# 会话正文改为 14px 的任务计划
- [x] Task 1: 调整会话正文基础字号样式
    - 1.1: 定位 `src/renderer/styles.css` 中 `.message-content` 规则
    - 1.2: 在 `.message-content` 中新增 `font-size: 14px;`
    - 1.3: 确认普通正文、Markdown 正文、折叠态预览都会继承该基础字号

- [x] Task 2: 校验变更影响范围并整理结果
    - 2.1: 检查是否误影响角色标签、状态信息、输入区等非正文元素
    - 2.2: 复核 Markdown 标题、代码块等已有单独字号规则是否保持原样
    - 2.3: 记录最终修改结果并生成 summary.md
