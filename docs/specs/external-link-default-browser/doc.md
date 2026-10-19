# external-link-default-browser

## 背景
当前会话消息中的 URL 会被 `react-markdown` 渲染为可点击链接，但应用没有拦截 Electron 窗口内的导航行为。用户点击后，主窗口会直接跳转到外部页面，覆盖原有聊天 UI，且界面内没有返回入口，导致会话上下文丢失。

## 需求场景与处理逻辑
### 场景：点击会话消息中的 URL
- 用户在会话区点击助手消息或工具消息中的 URL。
- 当前行为：链接在 Electron 主窗口内打开，直接替换聊天界面。
- 目标行为：链接不在应用内导航，统一交给系统默认浏览器打开。

### 处理逻辑
1. 渲染层继续保留 markdown 链接展示能力。
2. 消息中的 `<a>` 点击时，阻止浏览器默认导航。
3. 通过 preload 暴露的安全桥或现有 renderer→main IPC，把外链打开请求发送到主进程。
4. 主进程调用 Electron `shell.openExternal(url)` 使用默认浏览器打开链接。
5. 主进程同时对窗口级导航做兜底拦截，防止任何未被渲染层捕获的外链仍在主窗口内打开。

## 现状分析
### 相关代码路径
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageContent.tsx`
  - 当前使用 `ReactMarkdown` 渲染消息正文。
  - 未自定义 `a` 标签渲染，也未拦截点击事件。
- `e:\other-code\desktop-tools\src\renderer\features\messages\message-model.ts`
  - 助手消息与大多数工具消息会以 `markdown` 模式渲染，因此 URL 会进入 markdown 链接链路。
- `e:\other-code\desktop-tools\src\main\index.ts`
  - 当前仅创建 `BrowserWindow` 并加载 renderer 入口。
  - 未配置 `webContents.setWindowOpenHandler` 或 `will-navigate` 对外链做拦截。
- `e:\other-code\desktop-tools\src\preload\index.ts`（待确认现有 bridge 结构并扩展）
  - 预期在此增加安全暴露的“打开外部链接”接口。

## 架构与技术方案
### 方案选择
采用“渲染层主动拦截 + 主进程窗口级兜底”双保险方案：
- 渲染层负责把消息里的链接点击转为显式的外部打开动作，保证交互符合预期。
- 主进程负责阻止窗口内导航，避免任何遗漏路径继续覆盖 UI。

### 方案细节
#### 1. Renderer：自定义 markdown 链接组件
在 `MessageContent.tsx` 中为 `ReactMarkdown` 增加 `components.a`：
- 仅处理合法字符串 `href`。
- 在点击时执行 `event.preventDefault()`。
- 调用 preload 暴露的 API，例如 `window.desktopTools.openExternalLink(href)`。
- 为链接补充 `target="_blank"` 与 `rel="noreferrer"`，保持语义明确。

示意代码：
```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    a: ({ href, children, ...props }) => {
      const url = typeof href === 'string' ? href : '';
      return (
        <a
          {...props}
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            event.preventDefault();
            if (url) {
              void window.desktopTools.openExternalLink(url);
            }
          }}
        >
          {children}
        </a>
      );
    },
  }}
>
  {body.text}
</ReactMarkdown>
```

#### 2. Preload：暴露受控 API
在 preload 的 context bridge 中新增接口：
```ts
openExternalLink: (url: string) => ipcRenderer.invoke('shell:open-external', url)
```
同时更新共享类型声明，确保 renderer 侧有类型提示并且不直接访问 Electron API。

#### 3. Main：统一打开外链
在 `src/main/index.ts` 中新增 IPC handler：
```ts
ipcMain.handle('shell:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !url.trim()) {
    throw new TypeError('URL must be a non-empty string.');
  }
  await shell.openExternal(url.trim());
});
```
如项目已有相关 shell 工具封装，则优先复用现有模式，避免重复实现。

#### 4. Main：拦截窗口内导航
在主窗口创建后增加兜底策略：
- `mainWindow.webContents.setWindowOpenHandler(...)`
- `mainWindow.webContents.on('will-navigate', ...)`

处理原则：
- 若目标 URL 与 renderer 入口同源或为本地应用入口，不拦截。
- 若为 `http:` / `https:` 外链，则 `event.preventDefault()` 并调用 `shell.openExternal(url)`。
- 返回 `deny` 阻止在应用内新开窗口。

示意代码：
```ts
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  void shell.openExternal(url);
  return { action: 'deny' };
});

mainWindow.webContents.on('will-navigate', (event, url) => {
  if (shouldOpenExternally(url)) {
    event.preventDefault();
    void shell.openExternal(url);
  }
});
```

## 影响文件
### 必改文件
- `e:\other-code\desktop-tools\src\renderer\features\messages\MessageContent.tsx`
  - 修改类型：更新
  - 影响函数：`MessageContent`
  - 修改内容：自定义 markdown 链接渲染与点击拦截。

- `e:\other-code\desktop-tools\src\main\index.ts`
  - 修改类型：更新
  - 影响函数：`createMainWindow`
  - 修改内容：注册外链 IPC、阻止窗口内外链导航、改用默认浏览器打开。

- `e:\other-code\desktop-tools\src\preload\index.ts`
  - 修改类型：更新
  - 影响区域：context bridge 暴露 API
  - 修改内容：新增 renderer 调用主进程打开外链的方法。

### 可能联动文件
- `e:\other-code\desktop-tools\src\shared\contracts.ts`
  - 修改类型：更新
  - 修改内容：补充 preload 暴露 API 的类型定义（若当前项目在此维护 bridge 类型）。

- `e:\other-code\desktop-tools\src\renderer\*.d.ts` 或 preload 相关全局声明文件
  - 修改类型：按需更新
  - 修改内容：补充 `window` 全局类型，使 renderer 可安全调用新 API。

## 数据流路径
1. 会话消息文本进入 `message-model.ts`，被标记为 `markdown`。
2. `MessageList.tsx` 将 `body` 传入 `MessageContent.tsx`。
3. `MessageContent.tsx` 将 URL 渲染为链接，并在点击时阻止默认导航。
4. Renderer 通过 preload bridge 调用主进程 IPC。
5. 主进程使用 `shell.openExternal` 交给系统默认浏览器。
6. 若仍存在未拦截的导航尝试，`webContents` 兜底拦截并改为外部打开。

## 边界条件与异常处理
- 空字符串、非字符串 URL：直接拒绝，不执行打开。
- 非 `http/https` 协议：默认不作为外链放行，避免误触发不受控协议；是否支持 `mailto:` 取决于当前产品需求，本次先按最小修复范围仅处理网页链接。
- 相对路径或应用内资源地址：不应被误判为外链。
- `shell.openExternal` 失败：主进程抛错；renderer 无需额外 UI 变更，保持最小改动。
- 工具消息折叠态：折叠态只是纯文本预览，不涉及点击链接行为，无需改动。

## 预期结果
- 点击会话中的 URL 时，桌面应用界面保持在当前聊天页面不变。
- 系统默认浏览器打开对应链接。
- 不再出现“外链覆盖整个 UI 且无法返回”的问题。
- 现有 markdown 渲染、复制消息、工具消息展开/收起等行为保持不变。

## 验证要点
- 助手消息中的 `https://` 链接点击后在默认浏览器打开。
- 工具消息中的 markdown 链接点击后在默认浏览器打开。
- 点击链接后 Electron 主窗口 URL 不发生外部跳转。
- 构建与类型检查通过。