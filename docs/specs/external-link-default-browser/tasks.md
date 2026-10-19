# external-link-default-browser 任务计划
- [x] Task 1: 扩展 preload bridge 与共享类型，暴露受控的外链打开能力
    - 1.1: 在 `src/shared/contracts.ts` 为 `DesktopAppApi` 增加 `openExternalLink(url: string)` 方法定义
    - 1.2: 在 `src/preload/index.ts` 把 `openExternalLink` 通过 `ipcRenderer.invoke` 暴露给 renderer
    - 1.3: 确认 `src/renderer/env.d.ts` 继续复用 `Window.desktopApp` 类型，无需额外全局声明改动

- [x] Task 2: 调整消息 markdown 链接点击行为，改为调用默认浏览器
    - 2.1: 在 `src/renderer/features/messages/MessageContent.tsx` 为 `ReactMarkdown` 配置自定义 `a` 渲染
    - 2.2: 对链接点击执行 `preventDefault()`，并调用 `window.desktopApp.openExternalLink(href)`
    - 2.3: 保留现有 markdown 展示能力，并为链接补充 `target="_blank"` 与 `rel="noreferrer"`

- [x] Task 3: 在主进程统一处理外链并阻止应用内页面跳转
    - 3.1: 在 `src/main/index.ts` 引入 `shell` 并注册 `shell:open-external` IPC handler
    - 3.2: 增加外链判定逻辑，仅将 `http/https` URL 交给 `shell.openExternal`
    - 3.3: 在 `createMainWindow` 中配置 `webContents.setWindowOpenHandler`，阻止窗口内打开外链
    - 3.4: 在 `createMainWindow` 中配置 `webContents.on('will-navigate', ...)`，阻止当前窗口被外链覆盖

- [x] Task 4: 验证改动并确认任务文件状态
    - 4.1: 运行类型检查或构建，确认新增 bridge、renderer 与 main 改动可通过
    - 4.2: 回查 `tasks.md`，按完成情况逐项更新顶层任务复选框
