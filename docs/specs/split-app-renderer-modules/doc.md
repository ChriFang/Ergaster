# App.tsx 功能拆分重构方案

## 背景
当前 `e:\other-code\desktop-tools\src\renderer\App.tsx` 同时承担了消息渲染、工具消息解析、设置表单、输入区、工具确认卡片、右键复制菜单、与 `window.desktopApp` 的交互编排等职责，文件体积较大、局部逻辑耦合偏高，不利于后续维护和增量功能迭代。

本次目标是不改变现有交互行为与 IPC 契约，仅按功能模块完成拆分，让渲染层目录结构更清晰、职责边界更稳定。

## 需求场景与处理逻辑

### 场景 1：消息区域继续按现有行为展示
- 助手消息继续使用 Markdown 渲染。
- 工具消息继续解析 JSON 负载，保留成功/失败状态、参数摘要、折叠/展开、复制完整消息等行为。
- 非工具消息继续按纯文本或 Markdown 既有规则展示。
- 消息右键选中文本后仍可弹出复制菜单。

处理逻辑：
1. 将工具消息解析、消息体建模、预览文案生成等纯函数从 `App.tsx` 提取到独立模块。
2. 将消息列表与单条消息渲染抽成独立组件。
3. `App.tsx` 仅保留消息数据传递与顶层状态编排，不再直接承载消息项细节。

### 场景 2：设置面板继续可编辑并保存配置
- 保留 API Key 明文切换、模型名、Base URL、最大工具轮数、允许路径、搜索目录、草稿目录等配置项。
- 保留保存时仅在输入非空时覆盖 `deepseekApiKey` 的现有行为。
- 保留 `MaskedAppConfig -> AppConfig` 的表单归一化逻辑。

处理逻辑：
1. 将设置面板 JSX 提取成独立组件。
2. 将多行输入拆分与表单归一化逻辑提取成独立 model 文件。
3. 顶层组件继续拥有表单状态，避免本次重构引入跨组件状态同步复杂度。

### 场景 3：输入区与执行控制继续工作
- 保留输入框、发送、取消、回车发送、Shift+Enter 换行行为。
- 保留发送请求前后对 `messages`、`runStatus`、`isRunning`、`confirmationRequest` 的更新逻辑。
- 保留取消与重置会话行为。

处理逻辑：
1. 将输入区渲染抽成独立组件。
2. 发送/取消/重置等与 IPC 强耦合的逻辑仍保留在顶层容器中，避免过度抽象。

### 场景 4：工具确认面板与执行状态继续展示
- 工具调用等待确认时，继续展示确认卡片、摘要、工具名、风险等级。
- 执行中状态面板继续根据是否存在确认请求展示对应文案。

处理逻辑：
1. 将工具确认面板提取成独立组件。
2. 将执行中状态区提取成独立组件或轻量展示组件，减少 `App.tsx` JSX 深度。

## 架构与技术方案

采用“顶层容器 + 功能组件 + 纯函数工具模块”的拆分方式：

- `App.tsx`
  - 保留页面骨架布局。
  - 保留核心状态、生命周期、副作用、IPC 调用。
  - 负责连接各功能组件。

- `src/renderer/features/messages/`
  - 存放消息列表组件、消息项组件、消息解析与展示模型函数。

- `src/renderer/features/settings/`
  - 存放设置面板组件、表单转换函数。

- `src/renderer/features/composer/`
  - 存放输入区组件。

- `src/renderer/features/confirmation/`
  - 存放工具确认面板组件。

- `src/renderer/features/activity/`
  - 存放执行中状态卡片组件。

- `src/renderer/features/context-menu/`
  - 存放消息右键复制菜单组件。

此方案优先保证：
- 不改动 `window.desktopApp` 接口。
- 不改动共享类型定义。
- 不引入新的状态管理库。
- 不拆 CSS 文件结构，只复用现有 `styles.css` class，降低回归风险。

## 受影响文件

### 需要修改
1. `e:\other-code\desktop-tools\src\renderer\App.tsx`
   - 修改类型：重构、瘦身、导入新模块
   - 影响函数：`App`、局部事件处理逻辑、局部渲染逻辑
   - 调整内容：移除可提取的纯函数与大段 JSX，改为组合功能组件

### 需要新增
2. `e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts`
   - 修改类型：新增
   - 影响函数：`parseToolMessage`、`getToolDisplayText`、`getMessageBodyModel`、`getRoleLabel`、`getMessageKey`、`getCollapsedPreviewText`

3. `e:\other-code\desktop-tools\src\renderer\features\messages\MessageContent.tsx`
   - 修改类型：新增
   - 影响函数：消息体渲染，封装 Markdown/plain 两种展示

4. `e:\other-code\desktop-tools\src\renderer\features\messages\MessageList.tsx`
   - 修改类型：新增
   - 影响函数：消息列表与单条消息渲染映射

5. `e:\other-code\desktop-tools\src\renderer\features\settings\settings-model.ts`
   - 修改类型：新增
   - 影响函数：`splitMultilineInput`、`normalizeConfigForm`

6. `e:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx`
   - 修改类型：新增
   - 影响函数：设置表单展示与字段变更回调

7. `e:\other-code\desktop-tools\src\renderer\features\composer\Composer.tsx`
   - 修改类型：新增
   - 影响函数：输入区展示与提交/取消按钮交互

8. `e:\other-code\desktop-tools\src\renderer\features\confirmation\ConfirmationPanel.tsx`
   - 修改类型：新增
   - 影响函数：确认/拒绝工具执行面板展示

9. `e:\other-code\desktop-tools\src\renderer\features\activity\ActivityPanel.tsx`
   - 修改类型：新增
   - 影响函数：执行中状态展示

10. `e:\other-code\desktop-tools\src\renderer\features\context-menu\MessageContextMenu.tsx`
    - 修改类型：新增
    - 影响函数：右键菜单展示

### 可能复用，无需修改或仅调整导入
11. `e:\other-code\desktop-tools\src\renderer\config-form.ts`
    - 继续提供 `initialConfigForm`

12. `e:\other-code\desktop-tools\src\renderer\styles.css`
    - 预期无需新增样式；如拆分后存在细微布局问题，仅做最小修正

## 实现细节

### 1. 消息模型提取
将当前 `App.tsx` 顶部的消息解析与展示辅助逻辑移动到 `message-model.ts`：

```ts
export type ToolMessagePayload = {
  ok: boolean;
  content: string;
  data?: unknown;
  error?: string;
  summary?: string;
};

export type MessageBodyModel = {
  kind: 'markdown' | 'plain';
  text: string;
};

export function parseToolMessage(content: string): ToolMessagePayload | null {
  try {
    const parsed = JSON.parse(content) as ToolMessagePayload;
    return typeof parsed === 'object' && parsed !== null && typeof parsed.ok === 'boolean' ? parsed : null;
  } catch {
    return null;
  }
}
```

继续保留当前语义：
- assistant 总是 markdown
- tool message 若有 `error` / `content` 则 markdown
- tool message 若只有 `data` 则 plain + `JSON.stringify`
- 其他消息按 plain 展示

### 2. 消息列表组件化
`MessageList.tsx` 接收以下关键入参：

```ts
messages: AgentMessage[];
expandedToolMessageKeys: Record<string, boolean>;
onToggleToolMessage: (messageKey: string) => void;
onCopyMessage: (text: string) => void;
onMessageContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
```

组件内部完成：
- `visibleMessages.map(...)`
- 工具消息状态徽标
- 展开/收起切换
- 参数摘要展示
- 调用 `MessageContent` 渲染正文

### 3. 设置面板组件化
设置组件不直接持有状态，而是由 `App.tsx` 下发当前值与变更回调。这样可以避免：
- 保存成功后顶层与局部状态不一致
- 组件卸载/显示切换时额外同步逻辑

建议接口：

```ts
config: MaskedAppConfig | null;
formValues: AppConfig;
showApiKey: boolean;
saveStatus: string;
onToggleShowApiKey: () => void;
onSubmit: (event: FormEvent<HTMLFormElement>) => void;
onChange: (updater: (current: AppConfig) => AppConfig) => void;
apiKeyToggleImageSrc: string;
```

### 4. 输入区组件化
输入区组件负责视图和键盘交互透传：

```ts
value: string;
isRunning: boolean;
onChange: (value: string) => void;
onSubmit: (event: FormEvent<HTMLFormElement>) => void;
onCancel: () => void;
onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
```

保留原行为：
- `Enter` 提交
- `Shift + Enter` 换行
- 执行中禁用输入与发送按钮

### 5. 确认面板与执行状态组件化
将以下渲染逻辑独立：
- 执行中状态卡片
- 工具确认卡片
- 右键复制菜单

示例：

```tsx
{isRunning ? <ActivityPanel confirmationRequest={confirmationRequest} /> : null}
{confirmationRequest ? <ConfirmationPanel request={confirmationRequest} onApprove={...} onReject={...} /> : null}
{contextMenuState ? <MessageContextMenu x={...} y={...} onCopy={...} /> : null}
```

## 数据流路径

### 初始化
1. `App.tsx` 挂载
2. 调用 `window.desktopApp.getAppInfo()`、`getConfig()`、`getAgentMessages()`
3. `normalizeConfigForm` 将脱敏配置转成可编辑表单值
4. 顶层状态传递给各子组件

### 发送消息
1. `Composer` 提交
2. `App.tsx` 的 `handleRunAgent` 调用 `window.desktopApp.runAgent`
3. 更新 `messages`、`runStatus`、`isRunning`
4. `MessageList` 重新渲染

### 工具确认
1. preload 回调触发 `onToolConfirmationRequested`
2. `App.tsx` 更新 `confirmationRequest`
3. `ConfirmationPanel` 展示
4. 用户确认/拒绝后调用 `respondToolConfirmation`

### 文本复制
1. 用户点击复制按钮或右键选中菜单复制
2. `App.tsx` 调用 `window.desktopApp.copyText`
3. 更新 `runStatus`

## 边界条件与异常处理
- 工具消息 JSON 解析失败时，仍按普通消息处理，不能让消息列表渲染崩溃。
- 复制内容为空时，继续提示“没有可复制的内容”。
- 配置未加载时，设置面板仍应能安全渲染占位状态。
- 保存配置后继续清空 `deepseekApiKey` 输入值，避免明文残留在表单状态。
- 取消执行、重置会话、Agent 执行失败时，现有 `runStatus` 与消息回退逻辑必须保持不变。
- 折叠状态键值仍基于 `role/index/tool_call_id` 生成，避免不同消息误共用展开状态。

## 兼容性与约束
- 不修改 `e:\other-code\desktop-tools\src\shared\*` 下共享类型。
- 不修改 preload/main IPC 接口定义。
- 不新增第三方依赖。
- 不引入 Context、Redux、zustand 等全局状态方案。
- 新增文件保持 TypeScript + React 函数组件风格，与当前工程一致。

## 预期结果
- `App.tsx` 规模显著下降，职责集中在状态编排与布局。
- 消息展示、设置面板、输入区、确认面板等形成清晰模块边界。
- 现有功能、交互、样式与 IPC 行为保持一致。
- 后续新增消息样式、设置项、确认面板逻辑时，修改范围更可控。