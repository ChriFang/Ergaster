# DeepSeek 思考模式开关评估与实现方案

## 背景
用户希望基于 DeepSeek 官方思考模式文档，在当前桌面工具中增加“思考模式”设置，并将开关放在聊天输入框底部，作为发送前可见、可操作的控制项。

当前项目是一个 Electron + React 的 DeepSeek 桌面 Agent，模型请求由主进程统一发起，聊天输入区域由渲染进程 `Composer` 组件承载，配置项通过 `AppConfig` 在主/渲染进程间传递并持久化。

## 需求拆解
### 场景 1：用户在输入框底部查看并切换思考模式
- 在聊天输入框底部增加一个思考模式开关。
- 开关应与当前聊天发送区域视觉上归属一致，位于 `Composer` 底部动作区。
- 用户在发送前可以直接看到当前模式，不需要进入设置弹窗。
- 处理逻辑：切换开关后，前端状态立即更新；后续发送请求时带入当前模式值。

### 场景 2：发送请求时将思考模式配置传给 DeepSeek
- 根据 DeepSeek 官方文档，OpenAI 兼容格式下需通过 `extra_body` 传递：
  - `thinking: { type: 'enabled' | 'disabled' }`
- 当前 `createChatCompletion` 仅发送 `model`、`messages`、`tools`，需要补充 `extra_body.thinking`。
- 处理逻辑：
  - 开关开启：请求体中带 `extra_body: { thinking: { type: 'enabled' } }`
  - 开关关闭：请求体中带 `extra_body: { thinking: { type: 'disabled' } }`
- 采用显式传参，而不是依赖 DeepSeek 默认值，避免 UI 状态与实际请求行为不一致。

### 场景 3：配置加载、保存与默认值管理
- 如果该开关是“设置项”而不是“仅当前界面临时状态”，则应纳入 `AppConfig`，以便应用重启后保持用户选择。
- 处理逻辑：
  - 在共享配置中新增布尔字段，例如 `thinkingModeEnabled`
  - 在默认配置中给出初值
  - 在配置保存时写入 userData 下的配置文件
  - 在界面初始化时读取并展示

### 场景 4：多轮对话与 reasoning_content 兼容性
- 当前代码已支持从 DeepSeek 响应中读取 `reasoning_content`，但对外展示消息时并未透出该字段。
- DeepSeek 文档说明：
  - 若两个 user 消息之间**没有工具调用**，中间 assistant 的 `reasoning_content` 后续传回会被忽略；可不依赖它。
  - 若中间 assistant **发生了工具调用**，则 `reasoning_content` 在后续轮次中必须回传给 API。
- 当前主进程内部会把完整 `assistantMessage`（包含 `reasoning_content`）保存在 `workingMessages` 中，并在后续轮次继续发送，因此这部分与思考模式开关并不冲突。
- 结论：本次增加开关不需要额外重构多轮拼接逻辑，但需要避免破坏现有 `reasoning_content` 的保留链路。

## 技术方案

### 方案选择
采用“配置持久化 + 输入区快捷开关”的组合方案：
- 状态来源：`AppConfig` 持久化配置
- 操作入口：`Composer` 输入框底部开关
- 请求出口：`src/main/deepseek-client.ts`

这样可以兼顾：
- 使用时操作便捷
- 重启应用后保留用户偏好
- 请求行为与 UI 状态一致
- 改动范围较小，符合当前项目架构

### 数据流
1. 应用启动时，主进程返回配置给渲染进程。
2. 渲染进程将 `thinkingModeEnabled` 注入表单/页面状态。
3. `Composer` 渲染底部开关，用户切换后更新状态。
4. 若设计为立即持久化，则切换时触发保存；若设计为跟随“保存配置”按钮，则需要额外定义同步策略。
5. 用户发送消息时，主进程读取当前配置。
6. `createChatCompletion` 根据配置拼装 `extra_body.thinking` 后请求 DeepSeek。

## 架构影响点

### 共享配置模型
**文件**：`e:\other-code\desktop-tools\src\shared\config.ts`

**修改类型**：扩展配置结构、默认值、sanitize 逻辑

**涉及内容**：
- `AppConfig`
- `defaultConfig`
- `sanitizeConfig`
- `toMaskedConfig`（通常无需特殊处理，但要确保新增字段被透传）

**建议字段**：
```ts
thinkingModeEnabled: boolean;
```

**建议默认值**：
```ts
thinkingModeEnabled: true;
```

原因：DeepSeek 官方文档说明默认思考模式为 enabled。默认值与官方行为保持一致，可降低意外行为差异。

### 渲染层配置初值
**文件**：`e:\other-code\desktop-tools\src\renderer\config-form.ts`

**修改类型**：同步新增表单默认值

**涉及内容**：
- `initialConfigForm`

**建议实现**：
```ts
thinkingModeEnabled: true,
```

### 设置页数据保存链路
**文件**：`e:\other-code\desktop-tools\src\renderer\App.tsx`

**修改类型**：状态管理与保存载荷扩展

**涉及函数**：
- 配置初始化逻辑（`window.desktopApp.getConfig()` 返回后设置 `formValues`）
- `handleSaveConfig`
- `Composer` 挂载调用处

**建议实现要点**：
- `handleSaveConfig` 的 `payload` 中包含 `thinkingModeEnabled`
- 将当前值下发给 `Composer`
- 在 `Composer` 中增加 `onThinkingModeChange` 回调

### 输入框底部 UI
**文件**：`e:\other-code\desktop-tools\src\renderer\features\composer\Composer.tsx`

**修改类型**：增加受控开关 UI

**涉及组件**：
- `Composer`

**建议交互**：
- 在 `composer-actions` 区域中，位于 hint 文案与按钮组同层布局
- 使用 checkbox/switch 风格的受控组件
- 文案建议：`思考模式`
- 可附带简短说明：`开启后模型会先进行推理，再输出最终答案。`

**建议代码轮廓**：
```tsx
type ComposerProps = {
  value: string;
  isRunning: boolean;
  thinkingModeEnabled: boolean;
  onThinkingModeChange: (value: boolean) => void;
  ...
};
```

```tsx
<label className="composer-toggle">
  <input
    type="checkbox"
    checked={thinkingModeEnabled}
    onChange={(event) => onThinkingModeChange(event.target.checked)}
    disabled={isRunning}
  />
  <span>思考模式</span>
</label>
```

### DeepSeek 请求体
**文件**：`e:\other-code\desktop-tools\src\main\deepseek-client.ts`

**修改类型**：扩展请求 body

**涉及函数**：
- `createChatCompletion`

**建议实现**：
```ts
body: JSON.stringify({
  model: config.model,
  messages,
  tools,
  extra_body: {
    thinking: {
      type: config.thinkingModeEnabled ? 'enabled' : 'disabled',
    },
  },
}),
```

## 影响文件清单

### 必改文件
1. `e:\other-code\desktop-tools\src\shared\config.ts`
   - 新增配置字段
   - 扩展默认值与 sanitize

2. `e:\other-code\desktop-tools\src\renderer\config-form.ts`
   - 新增前端表单默认值

3. `e:\other-code\desktop-tools\src\renderer\App.tsx`
   - 传递状态到 `Composer`
   - 在保存配置时包含新字段
   - 接收开关变化并更新当前表单状态

4. `e:\other-code\desktop-tools\src\renderer\features\composer\Composer.tsx`
   - 在输入框底部增加开关 UI

5. `e:\other-code\desktop-tools\src\main\deepseek-client.ts`
   - 在请求体中加入 `extra_body.thinking`

### 可能改动文件
6. `e:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx`
   - 如果希望“设置页”也能展示该配置，则需要补一个对应字段
   - 如果仅保留输入区开关，则该文件可以不改

7. 渲染层样式文件
   - 需要根据 `Composer` 相关样式落点，补充开关样式
   - 当前尚未读取具体样式文件，实施时需定位 `composer` 样式定义位置并最小化调整

## 边界条件与异常处理

### 1. 默认值与 UI 一致性
- 若配置文件中没有该字段，应回退到默认值。
- 推荐默认值为 `true`，与 DeepSeek 默认行为保持一致。

### 2. 正在执行时是否允许切换
- 建议在 `isRunning` 时禁用开关，避免用户误以为本次正在进行中的请求会被中途切换。
- 切换只影响后续请求。

### 3. 保存策略差异
这是当前最需要确认的产品决策点：
- 方案 A：切换开关后只改当前页面状态，必须点击“设置”里的保存按钮才会持久化
- 方案 B：切换开关后立即保存配置，作为输入区的快捷设置

从交互一致性看，**更推荐方案 B**，因为开关位于输入框底部，用户通常会把它理解为即时生效的会话控制，而不是“改完还要去设置里保存”。

### 4. 工具调用链路兼容性
- 不应移除或截断 `reasoning_content` 在 `workingMessages` 中的保留。
- 否则可能破坏带工具调用的多轮对话。

### 5. API 兼容性
- 官方文档指出，思考模式下 `temperature`、`top_p` 等参数不生效。
- 当前项目没有发送这些参数，因此不存在额外冲突。

## 预期结果
- 输入框底部出现“思考模式”开关。
- 用户能在发送前快速切换该模式。
- 主进程请求 DeepSeek 时，始终显式传递 `extra_body.thinking.type`。
- 现有工具调用、多轮对话、`reasoning_content` 保留逻辑不被破坏。
- 若采用持久化方案，应用重启后仍保留用户最近一次选择。

## 当前评估结论
这个需求的实现难度较低，主要是一次跨 shared / renderer / main 的小范围联动改造。现有架构已经具备以下基础：
- 已有统一配置模型
- 已有配置加载/保存链路
- `Composer` 已是独立组件，适合插入底部开关
- `deepseek-client` 是唯一请求出口，适合集中加请求参数
- 当前内部消息已保留 `reasoning_content`，与思考模式兼容

## 需要你确认的点
为了避免后续实现方向偏掉，需要先确认这两个点：

1. **这个开关是否需要持久化保存？**
   - 选项 A：需要，作为正式配置项保存
   - 选项 B：不需要，只影响当前打开期间的状态

2. **设置页里是否也要出现同一个开关？**
   - 选项 A：只放输入框底部
   - 选项 B：输入框底部 + 设置页里也展示，保持双入口

如果你不特别指定，我后续会按下面默认方案推进：
- **持久化保存**
- **输入框底部为主入口，设置页不新增重复入口**
- **请求中显式传 `enabled/disabled`，不依赖服务端默认值**
