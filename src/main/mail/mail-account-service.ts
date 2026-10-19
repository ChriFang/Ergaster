import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { getAppDataRoot, getMailAccountsPath } from '../core/app-paths';
import { appendMainLog } from '../core/audit-log';
import type { MailAccountConfig, MailAccountInput, MailAccountListItem, MailSecurity } from '../../shared/mail';
import {
  applyDefaultFlag,
  normalizeAccount,
  pickDefaultAccount,
  toMaskedAccount,
  validateAccountInput,
} from './mail-account-utils';
import { encryptSecret, isSecretStorageAvailable } from './mail-secret-store';

type PersistShape = { accounts: MailAccountConfig[] };

const SECURITY_VALUES: MailSecurity[] = ['tls', 'starttls', 'none'];

function sanitizeStored(list: unknown): MailAccountConfig[] {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .filter((item): item is MailAccountConfig => {
      const account = item as Partial<MailAccountConfig>;
      return (
        typeof account?.id === 'string'
        && typeof account.label === 'string'
        && typeof account.host === 'string'
        && typeof account.user === 'string'
        && typeof account.encryptedPassword === 'string'
        && Number.isInteger(account.port)
        && SECURITY_VALUES.includes(account.security as MailSecurity)
      );
    })
    .map((account) => ({ ...account, isDefault: Boolean(account.isDefault) }));
}

/** 邮箱账户的内存态 + 持久化管理。单例，供 IPC handler 与邮件工具共用。 */
class MailAccountService {
  private accounts = new Map<string, MailAccountConfig>();
  private loaded = false;

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(getMailAccountsPath(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistShape>;
      this.rewrite(sanitizeStored(parsed.accounts));
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT') {
        await appendMainLog('ERROR', `[mail] Failed to read mail accounts, fallback to empty: ${nodeError.message}`);
      }
      this.accounts = new Map();
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  private rewrite(list: MailAccountConfig[]): void {
    this.accounts = new Map(list.map((account) => [account.id, account]));
  }

  private currentDefaultId(): string | null {
    for (const account of this.accounts.values()) {
      if (account.isDefault) {
        return account.id;
      }
    }
    return null;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(getAppDataRoot(), { recursive: true });
    const payload: PersistShape = { accounts: Array.from(this.accounts.values()) };
    await fs.writeFile(getMailAccountsPath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  async listAccounts(): Promise<MailAccountListItem[]> {
    await this.ensureLoaded();
    return Array.from(this.accounts.values()).map(toMaskedAccount);
  }

  /** 供邮件工具解析目标账户：指定 id/label 优先，其次默认账户，最后首个。 */
  async resolveAccount(accountId?: string): Promise<MailAccountConfig | null> {
    await this.ensureLoaded();
    return pickDefaultAccount(Array.from(this.accounts.values()), accountId);
  }

  async saveAccount(input: MailAccountInput): Promise<MailAccountListItem> {
    await this.ensureLoaded();
    const normalized = validateAccountInput(input);
    const existing = normalized.id ? this.accounts.get(normalized.id) : undefined;
    if (normalized.id && !existing) {
      throw new Error(`未找到邮箱账户：${normalized.id}`);
    }

    let encryptedPassword: string;
    if (normalized.password) {
      if (!isSecretStorageAvailable()) {
        throw new Error('系统密钥库不可用，无法安全保存邮箱密码。');
      }
      encryptedPassword = encryptSecret(normalized.password);
    } else if (existing) {
      encryptedPassword = existing.encryptedPassword;
    } else {
      throw new Error('新建账户必须填写邮箱密码。');
    }

    const id = existing?.id ?? crypto.randomUUID();
    const account = normalizeAccount({ id, input: normalized, encryptedPassword, isDefault: normalized.isDefault });
    this.accounts.set(id, account);

    const desiredDefault = normalized.isDefault ? id : (this.currentDefaultId() ?? id);
    this.rewrite(applyDefaultFlag(Array.from(this.accounts.values()), desiredDefault));
    await this.persist();

    const saved = this.accounts.get(id);
    if (!saved) {
      throw new Error('保存邮箱账户失败。');
    }
    return toMaskedAccount(saved);
  }

  async deleteAccount(id: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.accounts.delete(id)) {
      throw new Error(`未找到邮箱账户：${id}`);
    }
    this.rewrite(applyDefaultFlag(Array.from(this.accounts.values()), this.currentDefaultId()));
    await this.persist();
  }

  async setDefaultAccount(id: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.accounts.has(id)) {
      throw new Error(`未找到邮箱账户：${id}`);
    }
    this.rewrite(applyDefaultFlag(Array.from(this.accounts.values()), id));
    await this.persist();
  }
}

export const mailAccountService = new MailAccountService();
