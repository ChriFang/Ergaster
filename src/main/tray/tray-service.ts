import { app, BrowserWindow, Menu, Tray } from 'electron';
import path from 'node:path';
import { appendMainLog } from '../core/audit-log';

type MainWindowHandle = {
  getMainWindow: () => BrowserWindow | null;
  createMainWindow: () => void;
};

let tray: Tray | null = null;
let handle: MainWindowHandle | null = null;

/** 注入主窗口句柄，避免与 index.ts 循环依赖（沿用 ui-window-manager 的注入模式）。 */
export function initTrayService(getMainWindow: () => BrowserWindow | null, createMainWindow: () => void) {
  handle = { getMainWindow, createMainWindow };
}

export function createTray() {
  if (!handle || tray || process.platform !== 'win32') {
    return;
  }

  // 复用窗口/任务栏图标同款路径策略：开发与打包环境下 app.getAppPath() 都指向应用根
  const iconPath = path.join(app.getAppPath(), 'assets', 'icon.ico');
  try {
    tray = new Tray(iconPath);
  } catch (error) {
    void appendMainLog('ERROR', `创建托盘图标失败: ${error instanceof Error ? error.message : String(error)}`);
    tray = null;
    return;
  }

  tray.setToolTip('Ergaster');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    // app.quit() 会触发 before-quit 置位 isQuitting，close 拦截随之放行
    { label: '退出', click: () => app.quit() },
  ]));
  tray.on('click', () => showMainWindow());
}

export function destroyTray() {
  tray?.destroy();
  tray = null;
}

/** 唤起主窗口：隐藏于托盘时恢复显示，最小化时还原，窗口不存在（如崩溃后）则重建。 */
export function showMainWindow() {
  if (!handle) {
    return;
  }

  const win = handle.getMainWindow();
  if (!win || win.isDestroyed()) {
    handle.createMainWindow();
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
}
