# DeepSeek 思考模式开关任务计划
- [x] Task 1: 扩展共享配置并接入默认值
    - 1.1: 在 `src/shared/config.ts` 的 `AppConfig` 中新增 `thinkingModeEnabled` 布尔字段
    - 1.2: 在 `defaultConfig` 与 `sanitizeConfig` 中补充该字段，默认值设为 `true`
    - 1.3: 确认 `toMaskedConfig` 保持对新增字段的透传，不引入额外脱敏逻辑
    - 1.4: 在 `src/renderer/config-form.ts` 中同步前端表单默认值，保证首次加载与主进程配置一致

- [x] Task 2: 在输入框底部接入思考模式开关
    - 2.1: 扩展 `src/renderer/features/composer/Composer.tsx` 的 props，新增 `thinkingModeEnabled` 和 `onThinkingModeChange`
    - 2.2: 在 `Composer` 底部动作区增加“思考模式”受控开关，位置放在输入框底部，并在执行中禁用
    - 2.3: 在渲染层样式落点补充开关相关样式，保证与现有输入区布局一致且不影响发送/取消按钮
    - 2.4: 在 `src/renderer/App.tsx` 中向 `Composer` 传递状态与更新回调

- [x] Task 3: 打通配置保存链路与请求参数
    - 3.1: 在 `src/renderer/App.tsx` 的 `handleSaveConfig` 载荷中加入 `thinkingModeEnabled`
    - 3.2: 根据确认方案实现输入区开关与配置状态的同步策略，确保切换后的后续请求读取到最新值
    - 3.3: 在 `src/main/deepseek-client.ts` 的请求体中加入 `extra_body.thinking.type`
    - 3.4: 显式映射为 `enabled` / `disabled`，避免 UI 状态与 DeepSeek 实际行为不一致

- [x] Task 4: 验证多轮对话兼容性并完成回归检查
    - 4.1: 检查 `reasoning_content` 在工具调用场景下的保留链路未被本次改动破坏
    - 4.2: 验证缺省配置、已有本地配置、执行中禁用开关等边界行为
    - 4.3: 运行必要的类型检查或构建命令，确认改动未引入编译错误
    - 4.4: 更新 `tasks.md` 对应复选框状态，为最终总结准备结果信息
