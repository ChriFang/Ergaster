/** 邮件（IMAP 只读）接入的跨进程类型定义。不依赖 Electron / Node，供 main 与 renderer 共享。 */

export type MailSecurity = 'tls' | 'starttls' | 'none';

/** IMAP 账户默认端口（隐式 TLS）。 */
export const MAIL_DEFAULT_PORT = 993;
/** email_list_messages 默认返回条数。 */
export const MAIL_LIST_LIMIT_DEFAULT = 20;
/** email_list_messages / email_search 单次返回条数上限。 */
export const MAIL_LIST_LIMIT_MAX = 50;
/** 单封邮件正文返回的最大字符数，超出则截断并标注。 */
export const MAIL_BODY_MAX_CHARS = 10_000;

/** 落盘的账户配置（含 safeStorage 加密后的密码，仅在主进程内流转）。 */
export type MailAccountConfig = {
  id: string;
  label: string;
  host: string;
  port: number;
  security: MailSecurity;
  user: string;
  /** safeStorage 加密后的 base64 字符串，绝不下发给 renderer。 */
  encryptedPassword: string;
  isDefault: boolean;
};

/** renderer 保存账户时的入参。password 为空表示沿用已保存的密码（编辑场景）。 */
export type MailAccountInput = {
  /** 存在表示编辑既有账户，缺省表示新建。 */
  id?: string;
  label: string;
  host: string;
  port: number;
  security: MailSecurity;
  user: string;
  /** 明文密码，仅在用户新填/修改时传入。 */
  password?: string;
  isDefault?: boolean;
};

/** 下发给 renderer 的账户列表项，绝不含密码明文。 */
export type MailAccountListItem = {
  id: string;
  label: string;
  host: string;
  port: number;
  security: MailSecurity;
  user: string;
  isDefault: boolean;
  hasPassword: boolean;
};

export type MailAccountOperationResult = {
  ok: boolean;
  error?: string;
  /** 保存成功时回传的掩码账户项，便于 UI 直接更新。 */
  account?: MailAccountListItem;
};

export type MailTestResult = {
  ok: boolean;
  error?: string;
};

/** 邮箱/文件夹信息。 */
export type MailFolder = {
  path: string;
  name: string;
  specialUse?: string;
  subscribed: boolean;
};

export type MailAttachmentMeta = {
  filename: string;
  contentType: string;
  size: number;
};

/** 邮件信封摘要（列表/搜索结果）。 */
export type MailMessageSummary = {
  uid: number;
  subject: string;
  from: string;
  date: string;
  seen: boolean;
  hasAttachments: boolean;
  snippet?: string;
};

/** 单封邮件的读取结果（正文 + 附件元信息）。 */
export type MailMessageDetail = {
  uid: number;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  seen: boolean;
  text: string;
  /** 正文是否因超长被截断。 */
  truncated: boolean;
  attachments: MailAttachmentMeta[];
};
