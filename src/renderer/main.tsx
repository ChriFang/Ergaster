import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { UiWindowApp } from './features/ui-window/UiWindowApp';
import { desktopAppClient } from './lib/desktop/desktop-app-client';
import './styles.css';

// 渲染层崩溃表现为整窗空白且不留痕迹，把未捕获异常转发到主进程日志留现场
window.addEventListener('error', (event) => {
  desktopAppClient.reportRendererError(`uncaught error: ${event.message}\n${event.error?.stack ?? '(no stack)'}`);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? `${event.reason.message}\n${event.reason.stack ?? ''}` : String(event.reason);
  desktopAppClient.reportRendererError(`unhandled rejection: ${reason}`);
});

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
// 独立窗口分流：带 ?uiWindow=<token> 的窗口只渲染交互式 HTML 承载页，不启动整个应用
const uiWindowToken = new URLSearchParams(window.location.search).get('uiWindow');
if (uiWindowToken) {
  root.render(
    <React.StrictMode>
      <UiWindowApp token={uiWindowToken} />
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
