import { BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_UI_HTML_BYTES } from '../../shared/ui-form';
import type { UiWindowEvent, UiWindowOpenInput, UiWindowPayload, UiWindowSubmitInput } from '../../shared/ui-form';

/**
 * 交互式 HTML widget 的「独立窗口」管理。
 *
 * 主进程新开一个复用主窗口同款硬化 webPreferences 的 BrowserWindow，加载同一份 renderer 产物
 * 并带 ?uiWindow=<token> 分流参数；该窗口只承载与内联同构的 sandbox iframe（见 UiWindowApp）。
 * 提交/关闭经 ui-window:event 回传主窗口，走与内联提交同一条 runAgent 链路。
 * 一个 widgetId 至多一个窗口（重复打开则聚焦已有）。
 */
type PopoutEntry = { window: BrowserWindow; payload: UiWindowPayload };

const byToken = new Map<string, PopoutEntry>();
const tokenByWidgetId = new Map<string, string>();

function isExternalHttpUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 与主窗口一致的外链/导航加固：只允许留在自身入口，外部 http(s) 交给系统浏览器。 */
function hardenPopoutWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isExternalHttpUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}

export function registerUiWindowHandlers(getMainWindow: () => BrowserWindow | null, buildEntryUrl: () => string) {
  function pushEvent(event: UiWindowEvent) {
    const target = getMainWindow();
    if (!target || target.isDestroyed()) {
      return;
    }
    target.webContents.send('ui-window:event', event);
  }

  ipcMain.handle('ui-window:open', async (_event, input: UiWindowOpenInput): Promise<{ opened: boolean }> => {
    if (!input || !isNonEmptyString(input.conversationId) || !isNonEmptyString(input.widgetId) || !isNonEmptyString(input.title)) {
      throw new TypeError('openUiWindow 需要 conversationId / widgetId / title。');
    }
    if (typeof input.html !== 'string' || Buffer.byteLength(input.html, 'utf8') > MAX_UI_HTML_BYTES) {
      throw new Error('HTML 内容为空或超出体积上限。');
    }

    // 同一 widget 已有窗口：聚焦复用，不重复开
    const existingToken = tokenByWidgetId.get(input.widgetId);
    if (existingToken) {
      const existing = byToken.get(existingToken);
      if (existing && !existing.window.isDestroyed()) {
        if (existing.window.isMinimized()) {
          existing.window.restore();
        }
        existing.window.focus();
        return { opened: true };
      }
    }

    const token = randomUUID();
    const payload: UiWindowPayload = {
      conversationId: input.conversationId,
      widgetId: input.widgetId,
      title: input.title,
      html: input.html,
    };

    const win = new BrowserWindow({
      width: 960,
      height: 800,
      minWidth: 420,
      minHeight: 320,
      backgroundColor: '#0b1120',
      title: input.title,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });
    win.removeMenu();
    hardenPopoutWindow(win);

    byToken.set(token, { window: win, payload });
    tokenByWidgetId.set(input.widgetId, token);

    win.on('closed', () => {
      byToken.delete(token);
      if (tokenByWidgetId.get(input.widgetId) === token) {
        tokenByWidgetId.delete(input.widgetId);
      }
      pushEvent({ type: 'closed', conversationId: input.conversationId, widgetId: input.widgetId });
    });

    const url = new URL(buildEntryUrl());
    url.searchParams.set('uiWindow', token);
    await win.loadURL(url.toString());
    return { opened: true };
  });

  ipcMain.handle('ui-window:claim', async (_event, token: string): Promise<UiWindowPayload | null> => {
    const entry = typeof token === 'string' ? byToken.get(token) : undefined;
    return entry ? entry.payload : null;
  });

  ipcMain.handle('ui-window:submit', async (_event, input: UiWindowSubmitInput): Promise<void> => {
    const entry = input && typeof input.token === 'string' ? byToken.get(input.token) : undefined;
    if (!entry) {
      return;
    }
    const data = input.data && typeof input.data === 'object' ? input.data : {};
    pushEvent({
      type: 'submit',
      conversationId: entry.payload.conversationId,
      widgetId: entry.payload.widgetId,
      title: entry.payload.title,
      data,
    });
  });

  ipcMain.handle('ui-window:close', async (_event, widgetId: string): Promise<void> => {
    const token = typeof widgetId === 'string' ? tokenByWidgetId.get(widgetId) : undefined;
    if (!token) {
      return;
    }
    const entry = byToken.get(token);
    if (entry && !entry.window.isDestroyed()) {
      entry.window.close();
    }
  });
}
