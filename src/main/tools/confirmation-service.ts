import { BrowserWindow, ipcMain } from 'electron';
import { appendMainLog } from '../core/audit-log';
import type { ToolConfirmationOutcome, ToolConfirmationRequest, ToolConfirmationResponsePayload } from '../../shared/tools';

let pendingConfirmation: {
  resolve: (value: ToolConfirmationOutcome) => void;
  reject: (reason?: unknown) => void;
  summary: string;
  /** 命令白名单建议前缀；非空时用户可勾选「总是允许此命令」。 */
  commandAutoAllow?: string;
  /** 下载域名；非空时用户可勾选「总是允许此域名」。 */
  domainAutoAllow?: string;
} | null = null;

export type ConfirmationAllowlistWriters = {
  appendCommandAllowlist?: (prefix: string) => Promise<void>;
  appendDownloadAllowedHost?: (host: string) => Promise<void>;
};

export function registerConfirmationHandlers(writers: ConfirmationAllowlistWriters = {}) {
  ipcMain.handle('tool:confirm-response', async (_event, payload: boolean | Partial<ToolConfirmationResponsePayload>) => {
    if (!pendingConfirmation) {
      return false;
    }

    const isObject = typeof payload === 'object' && payload !== null;
    const approved = typeof payload === 'boolean' ? payload : payload?.approved !== false;
    const autoRun = isObject ? Boolean(payload.autoRun) : false;
    const autoAllowCommand = isObject ? Boolean(payload.autoAllowCommand) : false;
    const autoAllowDomain = isObject ? Boolean(payload.autoAllowDomain) : false;
    const current = pendingConfirmation;
    pendingConfirmation = null;

    if (approved && autoAllowCommand && current.commandAutoAllow && writers.appendCommandAllowlist) {
      try {
        await writers.appendCommandAllowlist(current.commandAutoAllow);
      } catch (error) {
        await appendMainLog('WARN', `命令白名单写入失败: prefix=${current.commandAutoAllow} error=${String(error)}`);
      }
    }

    if (approved && autoAllowDomain && current.domainAutoAllow && writers.appendDownloadAllowedHost) {
      try {
        await writers.appendDownloadAllowedHost(current.domainAutoAllow);
      } catch (error) {
        await appendMainLog('WARN', `下载域名白名单写入失败: host=${current.domainAutoAllow} error=${String(error)}`);
      }
    }

    await appendMainLog('INFO', `Tool confirmation resolved: ${approved ? 'approved' : 'rejected'}${approved && autoRun ? ' (auto-run remembered)' : ''}${approved && autoAllowCommand ? ` (command allowlisted: ${current.commandAutoAllow})` : ''}${approved && autoAllowDomain ? ` (download host allowlisted: ${current.domainAutoAllow})` : ''} summary=${current.summary}`);
    current.resolve({ approved, autoRun, autoAllowCommand, autoAllowDomain });
    return true;
  });
}

export async function requestToolConfirmation(request: ToolConfirmationRequest): Promise<ToolConfirmationOutcome> {
  if (request.risk === 'low') {
    return { approved: true, autoRun: false };
  }

  if (pendingConfirmation) {
    throw new Error('已有待确认的工具请求。');
  }

  const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && !item.webContents.isDestroyed());

  if (!window) {
    throw new Error('当前没有可用窗口用于确认工具调用。');
  }

  await appendMainLog('INFO', `Tool confirmation requested: tool=${request.toolName} risk=${request.risk} summary=${request.summary}`);

  return new Promise<ToolConfirmationOutcome>((resolve, reject) => {
    pendingConfirmation = {
      resolve,
      reject,
      summary: request.summary,
      commandAutoAllow: request.commandAutoAllow,
      domainAutoAllow: request.domainAutoAllow,
    };

    try {
      window.webContents.send('tool:confirm', request);
    } catch (error) {
      pendingConfirmation = null;
      reject(error);
    }
  });
}

export function cancelPendingConfirmation() {
  if (!pendingConfirmation) {
    return;
  }

  const current = pendingConfirmation;
  pendingConfirmation = null;
  void appendMainLog('INFO', `Tool confirmation cancelled: summary=${current.summary}`);
  current.resolve({ approved: false, autoRun: false });
}
