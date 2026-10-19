# external-link-default-browser

## 完成情况
已完成会话 URL 外链打开行为修复，点击消息中的网页链接时不再覆盖桌面应用主界面，而是改为调用系统默认浏览器打开。

## 实际改动
- 在 `src/shared/contracts.ts` 中为 `DesktopAppApi` 增加 `openExternalLink(url: string)` 类型定义。
- 在 `src/preload/index.ts` 中通过 `ipcRenderer.invoke('shell:open-external', url)` 暴露 renderer 可调用的受控外链打开接口。
- 在 `src/renderer/features/messages/MessageContent.tsx` 中为 `ReactMarkdown` 增加自定义 `a` 渲染：
  - 对链接点击执行 `preventDefault()`
  - 调用 `window.desktopApp.openExternalLink(url)`
  - 保留现有 markdown 展示，并设置 `target="_blank"`、`rel="noreferrer"`
- 在 `src/main/index.ts` 中增加统一外链处理：
  - 新增 `isExternalHttpUrl` 判定，仅允许 `http/https`
  - 新增 `shell:open-external` IPC handler
  - 在 `createMainWindow` 中通过 `setWindowOpenHandler` 拒绝应用内打开外链
  - 在 `will-navigate` 中拦截当前窗口导航，避免外链覆盖聊天 UI

## 验证结果
- `npm run typecheck` 已通过。
- `tasks.md` 顶层任务已全部更新为完成状态。

## 结果
- 点击会话中的 URL 时，应用仍停留在当前聊天界面。
- 外部网页由系统默认浏览器打开。
- 原有消息渲染与交互流程未做额外扩展。