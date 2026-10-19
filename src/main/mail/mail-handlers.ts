import { ipcMain } from 'electron';
import type {
  MailAccountInput,
  MailAccountListItem,
  MailAccountOperationResult,
  MailTestResult,
} from '../../shared/mail';
import { getMailAccountsPath } from '../core/app-paths';
import { mailAccountService } from './mail-account-service';
import { validateAccountInput } from './mail-account-utils';
import { decryptSecret } from './mail-secret-store';
import { testConnection } from './imap-client';

const TEST_TIMEOUT_MS = 20_000;

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败。';
}

export function registerMailHandlers() {
  ipcMain.handle('mail:list-accounts', async (): Promise<MailAccountListItem[]> => {
    return mailAccountService.listAccounts();
  });

  ipcMain.handle('mail:save-account', async (_event, input: MailAccountInput): Promise<MailAccountOperationResult> => {
    try {
      const account = await mailAccountService.saveAccount(input);
      return { ok: true, account };
    } catch (error) {
      return { ok: false, error: toMessage(error) };
    }
  });

  ipcMain.handle('mail:delete-account', async (_event, id: string): Promise<MailAccountOperationResult> => {
    try {
      await mailAccountService.deleteAccount(id);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toMessage(error) };
    }
  });

  ipcMain.handle('mail:set-default-account', async (_event, id: string): Promise<MailAccountOperationResult> => {
    try {
      await mailAccountService.setDefaultAccount(id);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toMessage(error) };
    }
  });

  ipcMain.handle('mail:test-account', async (_event, input: MailAccountInput): Promise<MailTestResult> => {
    try {
      const normalized = validateAccountInput(input);
      let password = normalized.password;
      if (!password && normalized.id) {
        const existing = await mailAccountService.resolveAccount(normalized.id);
        if (existing) {
          password = decryptSecret(existing.encryptedPassword);
        }
      }
      if (!password) {
        return { ok: false, error: '请填写邮箱密码后再测试连接。' };
      }
      await testConnection(
        { host: normalized.host, port: normalized.port, security: normalized.security, user: normalized.user, password },
        AbortSignal.timeout(TEST_TIMEOUT_MS),
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toMessage(error) };
    }
  });

  ipcMain.handle('mail:test-account-by-id', async (_event, id: string): Promise<MailTestResult> => {
    try {
      const accountId = typeof id === 'string' ? id.trim() : '';
      if (!accountId) {
        return { ok: false, error: '缺少账户 id。' };
      }
      const account = await mailAccountService.resolveAccount(accountId);
      if (!account) {
        return { ok: false, error: `未找到邮箱账户：${accountId}` };
      }
      await testConnection(
        { host: account.host, port: account.port, security: account.security, user: account.user, password: decryptSecret(account.encryptedPassword) },
        AbortSignal.timeout(TEST_TIMEOUT_MS),
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toMessage(error) };
    }
  });

  ipcMain.handle('mail:get-config-path', async (): Promise<string> => {
    return getMailAccountsPath();
  });
}
