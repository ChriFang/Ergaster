# 精简系统执行中卡片

## 需求场景与处理逻辑

当前会话区在智能体请求已发起、但尚未出现模型流式输出时，会显示一个“系统正在执行”卡片。现有卡片包含：

- 头部角色：`系统`
- 状态徽标：`执行中.` / `执行中..` / `执行中...`
- 正文：`正在处理当前请求，请稍候.` / `..` / `...`

用户反馈该卡片有点冗余，要求：

- 只保留 `.` / `..` / `...` 交替显示。
- 给这个卡片增加一个合理的头像。

处理目标是让执行中状态更轻量：保留卡片作为占位和反馈，但删除重复文案，只显示动态点序列，并添加一个系统/执行状态头像。

## 架构与技术方案

### 1. 修改执行中卡片结构

当前组件位于：

- `e:\other-code\desktop-tools\src\renderer\features\activity\ActivityPanel.tsx`

现有 `DOTS_SEQUENCE` 已满足需求：

```ts
const DOTS_SEQUENCE = ['.', '..', '...'];
```

保留现有 `useEffect` 定时切换逻辑，不引入新的动画库或复杂状态。

执行中分支从现有结构：

```tsx
<section className="activity-panel activity-panel-running">
  <div className="message-header">
    <span className="message-role">系统</span>
    <div className="message-header-actions">
      <div className="message-status message-status-running">执行中{DOTS_SEQUENCE[dotIndex]}</div>
    </div>
  </div>
  <div className="message-content">
    <p>正在处理当前请求，请稍候{DOTS_SEQUENCE[dotIndex]}</p>
  </div>
</section>
```

调整为更紧凑的行内结构：

```tsx
<section className="activity-panel activity-panel-running activity-panel-running-compact">
  <div className="activity-running-row">
    <span className="activity-running-avatar" aria-hidden="true">
      <Bot size={16} strokeWidth={2} />
    </span>
    <span className="activity-running-dots" aria-label="系统正在执行">
      {DOTS_SEQUENCE[dotIndex]}
    </span>
  </div>
</section>
```

选择 `Bot` 图标作为头像，理由：

- 项目已使用 `lucide-react`，无需新增依赖。
- `Bot` 已用于智能体相关入口，语义上适合作为系统/智能体执行状态头像。
- 头像与执行中状态卡片匹配，不需要额外文字说明。

### 2. 保留错误卡片现有行为

`errorMessage` 分支保持不变：

- 仍展示 `系统`。
- 仍展示 `失败` 状态。
- 仍展示错误信息。

本次只改执行中卡片，不影响错误状态。

### 3. 样式调整

当前样式位于：

- `e:\other-code\desktop-tools\src\renderer\styles.css`

新增样式：

```css
.activity-panel-running-compact {
  width: auto;
  min-width: 86px;
  padding: 10px 12px;
}

.activity-running-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.activity-running-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background: rgba(37, 99, 235, 0.18);
  color: #bfdbfe;
  border: 1px solid rgba(96, 165, 250, 0.24);
}

.activity-running-dots {
  min-width: 22px;
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: 16px;
  letter-spacing: 0.08em;
}
```

由于父级 `.console-inline-panel .activity-panel` 当前会设置 `width: min(680px, 100%)`，需要新增更具体规则让紧凑卡片按内容宽度显示：

```css
.console-inline-panel .activity-panel-running-compact {
  width: auto;
  max-width: max-content;
}
```

## 受影响文件

### `e:\other-code\desktop-tools\src\renderer\features\activity\ActivityPanel.tsx`

修改类型：执行中卡片 JSX 结构调整。

影响内容：

- 从 `lucide-react` 引入 `Bot`。
- 保留 `DOTS_SEQUENCE` 和定时切换逻辑。
- 执行中分支删除 `执行中` 和 `正在处理当前请求，请稍候` 两处文案。
- 执行中分支新增头像和只显示点序列。
- 错误分支不变。

### `e:\other-code\desktop-tools\src\renderer\styles.css`

修改类型：新增紧凑执行中卡片样式。

影响内容：

- 新增 `.activity-panel-running-compact`。
- 新增 `.activity-running-row`。
- 新增 `.activity-running-avatar`。
- 新增 `.activity-running-dots`。
- 新增 `.console-inline-panel .activity-panel-running-compact` 覆盖宽度规则。

## 数据流路径

1. 用户提交输入。
2. `useChatSession` 将 `isRunning` 置为 `true`。
3. 在没有确认弹窗、错误和可见流式助手消息时，`showRunningActivityPanel` 为 `true`。
4. `ConsolePanel` 渲染 `ActivityPanel`。
5. `ActivityPanel` 用现有 `DOTS_SEQUENCE` 每 500ms 切换显示 `.` / `..` / `...`。
6. 卡片展示头像和动态点，不再展示额外执行文案。

## 边界条件与异常处理

- 非运行状态：`dotIndex` 仍重置为 `0`。
- 错误状态：错误卡片不受影响，继续展示错误信息。
- 流式助手消息出现后：现有逻辑隐藏执行中卡片，不改变。
- 无障碍：点序列元素增加 `aria-label="系统正在执行"`，避免屏幕阅读器只读出标点。
- 依赖：使用项目已有 `lucide-react`，不新增依赖。

## 预期结果

- 执行中卡片只显示头像和 `.` / `..` / `...` 动态点。
- 不再显示 `系统`、`执行中...`、`正在处理当前请求，请稍候...` 等冗余文案。
- 卡片宽度更紧凑，按内容收缩。
- 错误卡片和其它消息卡片不受影响。
- TypeScript 类型检查通过。
