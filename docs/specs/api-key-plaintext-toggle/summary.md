# DeepSeek API Key 图片展示修复总结

## 问题原因
此前在 `src/renderer/App.tsx` 中直接使用了本地 `file:///E:/.../mingwen.png` 绝对路径。该方式没有经过 Vite 的静态资源管理，导致 Renderer 中按钮区域存在，但图片本身无法稳定加载显示。

## 完成结果
- 已将图片复制到 Renderer 可被 Vite 管理的静态资源目录：
  - `e:\other-code\desktop-tools\src\renderer\assets\mingwen.png`
- 已在 `src/renderer/App.tsx` 中改为使用模块化资源导入：
  - `import apiKeyToggleImageSrc from './assets/mingwen.png';`
- 已移除原先的 `file:///` 绝对路径写法
- 保留了图片按钮悬浮在 API Key 输入框上的交互与布局
- 保留了 `showApiKey` 的明文切换逻辑
- 未改动 IPC、配置读取返回结构、主进程 DeepSeek 调用逻辑

## 影响文件
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
- `e:\other-code\desktop-tools\src\renderer\assets\mingwen.png`
- `e:\other-code\desktop-tools\.comate\specs\api-key-plaintext-toggle\tasks.md`

## 验证结果
- `npm run typecheck` 通过
- 图片资源已进入 Renderer 资源目录，可由 Vite 构建链路正常处理
- 明文开关仍仅作用于当前输入值，不会回传或暴露已保存的历史明文 API Key

## 结果说明
这次修复的重点是资源接入方式，而不是功能逻辑本身。修复后，图片按钮应当可以在开发环境和构建产物中正常显示，同时保持原有安全边界不变。
