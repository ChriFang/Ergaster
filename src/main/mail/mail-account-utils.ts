import type { MailAccountConfig, MailAccountInput, MailAccountListItem, MailSecurity } from '../../shared/mail';
import { MAIL_DEFAULT_PORT } from '../../shared/mail';

const SECURITY_VALUES: MailSecurity[] = ['tls', 'starttls', 'none'];
const DEFAULT_STARTTLS_PORT = 143;

/** 校验并规范化后的账户入参（尚未落盘，密码仍是明文或缺省）。 */
export type NormalizedAccountInput = {
  id?: string;
  label: string;
  host: string;
  port: number;
  security: MailSecurity;
  user: string;
  password?: string;
  isDefault: boolean;
};

function normalizeSecurity(value: unknown): MailSecurity {
  return SECURITY_VALUES.includes(value as MailSecurity) ? (value as MailSecurity) : 'tls';
}

function normalizePort(port: unknown, security: MailSecurity): number {
  const value = Number(port);
  if (Number.isInteger(value) && value >= 1 && value <= 65_535) {
    return value;
  }
  return security === 'tls' ? MAIL_DEFAULT_PORT : DEFAULT_STARTTLS_PORT;
}

/** 校验 renderer 传入的账户表单，返回规范化结果；非法输入抛出可读错误。 */
export function validateAccountInput(input: MailAccountInput): NormalizedAccountInput {
  const label = (input?.label ?? '').trim();
  const host = (input?.host ?? '').trim();
  const user = (input?.user ?? '').trim();
  const security = normalizeSecurity(input?.security);
  const port = normalizePort(input?.port, security);
  const id = typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : undefined;
  const password = typeof input?.password === 'string' && input.password.length > 0 ? input.password : undefined;

  if (!label) {
    throw new Error('账户名称不能为空。');
  }
  if (!host) {
    throw new Error('IMAP 服务器地址不能为空。');
  }
  if (!user) {
    throw new Error('登录用户名不能为空。');
  }

  return { id, label, host, port, security, user, password, isDefault: Boolean(input?.isDefault) };
}

/** 用规范化入参 + 已加密密码组装可落盘的账户配置。 */
export function normalizeAccount(params: {
  id: string;
  input: NormalizedAccountInput;
  encryptedPassword: string;
  isDefault: boolean;
}): MailAccountConfig {
  return {
    id: params.id,
    label: params.input.label,
    host: params.input.host,
    port: params.input.port,
    security: params.input.security,
    user: params.input.user,
    encryptedPassword: params.encryptedPassword,
    isDefault: params.isDefault,
  };
}

/** 转换为下发 renderer 的掩码项，剥离加密密码。 */
export function toMaskedAccount(account: MailAccountConfig): MailAccountListItem {
  return {
    id: account.id,
    label: account.label,
    host: account.host,
    port: account.port,
    security: account.security,
    user: account.user,
    isDefault: Boolean(account.isDefault),
    hasPassword: account.encryptedPassword.length > 0,
  };
}

/** 解析工具应使用哪个账户：指定 id/label 命中优先，其次默认账户，最后第一个。 */
export function pickDefaultAccount(accounts: MailAccountConfig[], accountId?: string): MailAccountConfig | null {
  if (accounts.length === 0) {
    return null;
  }

  const key = accountId?.trim();
  if (key) {
    const matched = accounts.find((account) => account.id === key || account.label === key);
    return matched ?? null;
  }

  return accounts.find((account) => account.isDefault) ?? accounts[0];
}

/** 归一化默认标记：确保至多一个账户 isDefault，且列表非空时必有默认。 */
export function applyDefaultFlag(accounts: MailAccountConfig[], defaultId: string | null): MailAccountConfig[] {
  if (accounts.length === 0) {
    return [];
  }

  const target = accounts.some((account) => account.id === defaultId)
    ? defaultId
    : (accounts.find((account) => account.isDefault) ?? accounts[0]).id;

  return accounts.map((account) => ({ ...account, isDefault: account.id === target }));
}
