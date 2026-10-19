import { ImapFlow, type FetchMessageObject, type ImapFlowError, type MessageAddressObject, type MessageStructureObject } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import type { MailAccountConfig, MailFolder, MailMessageDetail, MailMessageSummary, MailSecurity } from '../../shared/mail';
import { appendMainLog } from '../core/audit-log';
import { buildImapSearch, type MailSearchArgs } from './mail-search-query';
import { truncateBody } from './mail-format';
import { decryptSecret } from './mail-secret-store';

const CONNECT_TIMEOUT_MS = 15_000;

/** IMAP 连接参数（明文密码，仅在主进程内短暂持有）。 */
export type ImapConnParams = {
  host: string;
  port: number;
  security: MailSecurity;
  user: string;
  password: string;
};

function toConnParams(account: MailAccountConfig): ImapConnParams {
  return {
    host: account.host,
    port: account.port,
    security: account.security,
    user: account.user,
    password: decryptSecret(account.encryptedPassword),
  };
}

function buildClient(params: ImapConnParams): ImapFlow {
  return new ImapFlow({
    host: params.host,
    port: params.port,
    secure: params.security === 'tls',
    auth: { user: params.user, pass: params.password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: 60_000,
  });
}

/** 把 imapflow 抛出的错误提炼成可读原因（服务端命令/状态/响应文本/错误码），而不是笼统的 "Command failed"。 */
function describeImapError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const detail = error as ImapFlowError;
  const parts: string[] = [];
  if (detail.authenticationFailed) {
    parts.push('认证失败（用户名/密码或授权码不正确）');
  }
  if (detail.mailboxMissing) {
    parts.push('目标邮箱/文件夹不存在');
  }
  if (detail.command) {
    parts.push(`命令 ${detail.command}`);
  }
  if (detail.responseStatus) {
    parts.push(`响应 ${detail.responseStatus}`);
  }
  if (detail.serverResponseCode) {
    parts.push(detail.serverResponseCode);
  }
  const text = detail.responseText || error.message;
  if (text) {
    parts.push(text);
  }
  if (detail.code) {
    parts.push(`code=${detail.code}`);
  }
  return parts.filter(Boolean).join(' | ') || '未知错误';
}

/** 连接 → 执行 → 收尾。绑定 AbortSignal 到 close()，finally 里 logout。错误日志只记录 host 与服务端原因，不含凭据。 */
async function connectAndRun<T>(params: ImapConnParams, signal: AbortSignal, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = buildClient(params);
  const onAbort = () => client.close();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await client.connect();
    return await fn(client);
  } catch (error) {
    const detail = describeImapError(error);
    await appendMainLog('ERROR', `[mail] IMAP operation failed: host=${params.host} detail=${detail}`);
    throw new Error(detail);
  } finally {
    signal.removeEventListener('abort', onAbort);
    await client.logout().catch(() => client.close());
  }
}

function formatEnvelopeAddress(list: MessageAddressObject[] | undefined): string {
  if (!list || list.length === 0) {
    return '';
  }
  return list
    .map((item) => (item.name && item.address ? `${item.name} <${item.address}>` : item.address ?? item.name ?? ''))
    .filter(Boolean)
    .join(', ');
}

function structureHasAttachment(node: MessageStructureObject | undefined): boolean {
  if (!node) {
    return false;
  }
  if (node.disposition && node.disposition.toLowerCase() === 'attachment') {
    return true;
  }
  return (node.childNodes ?? []).some((child) => structureHasAttachment(child));
}

function toIsoDate(value: Date | string | undefined): string {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toSummary(message: FetchMessageObject): MailMessageSummary {
  const envelope = message.envelope;
  return {
    uid: message.uid,
    subject: envelope?.subject ?? '',
    from: formatEnvelopeAddress(envelope?.from),
    date: toIsoDate(envelope?.date),
    seen: message.flags?.has('\\Seen') ?? false,
    hasAttachments: structureHasAttachment(message.bodyStructure),
  };
}

function addressListToStrings(value: AddressObject | AddressObject[] | undefined): string[] {
  if (!value) {
    return [];
  }
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => item.text).filter(Boolean);
}

const FETCH_QUERY = { uid: true, flags: true, envelope: true, bodyStructure: true } as const;

export async function listMailboxes(account: MailAccountConfig, signal: AbortSignal): Promise<MailFolder[]> {
  return connectAndRun(toConnParams(account), signal, async (client) => {
    const list = await client.list();
    return list.map((item) => ({
      path: item.path,
      name: item.name,
      specialUse: item.specialUse,
      subscribed: item.subscribed,
    }));
  });
}

export async function listMessages(
  account: MailAccountConfig,
  mailbox: string,
  limit: number,
  signal: AbortSignal,
): Promise<MailMessageSummary[]> {
  return connectAndRun(toConnParams(account), signal, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      const total = client.mailbox ? client.mailbox.exists : 0;
      if (total === 0) {
        return [];
      }
      const start = Math.max(1, total - limit + 1);
      const messages = await client.fetchAll(`${start}:*`, FETCH_QUERY);
      return messages.map(toSummary).reverse();
    } finally {
      lock.release();
    }
  });
}

export async function searchMessages(
  account: MailAccountConfig,
  mailbox: string,
  args: MailSearchArgs,
  limit: number,
  signal: AbortSignal,
): Promise<MailMessageSummary[]> {
  return connectAndRun(toConnParams(account), signal, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      const found = await client.search(buildImapSearch(args), { uid: true });
      const uids = Array.isArray(found) ? found : [];
      if (uids.length === 0) {
        return [];
      }
      const recent = uids.slice(-limit);
      const messages = await client.fetchAll(recent, FETCH_QUERY, { uid: true });
      return messages.map(toSummary).reverse();
    } finally {
      lock.release();
    }
  });
}

export async function readMessage(
  account: MailAccountConfig,
  mailbox: string,
  uid: number,
  signal: AbortSignal,
): Promise<MailMessageDetail> {
  return connectAndRun(toConnParams(account), signal, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      const message = await client.fetchOne(uid, { uid: true, flags: true, source: true }, { uid: true });
      if (!message || !message.source) {
        throw new Error(`未找到 UID 为 ${uid} 的邮件。`);
      }
      const parsed = await simpleParser(message.source);
      const body = truncateBody(parsed.text ?? parsed.textAsHtml ?? '');
      return {
        uid: message.uid,
        subject: parsed.subject ?? '',
        from: parsed.from?.text ?? '',
        to: addressListToStrings(parsed.to),
        cc: addressListToStrings(parsed.cc),
        date: toIsoDate(parsed.date),
        seen: message.flags?.has('\\Seen') ?? false,
        text: body.text,
        truncated: body.truncated,
        attachments: parsed.attachments.map((item) => ({
          filename: item.filename ?? '',
          contentType: item.contentType,
          size: item.size,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

/** 用给定连接参数试连接一次（列出邮箱后登出）。失败抛错，供设置页"测试连接"。 */
export async function testConnection(params: ImapConnParams, signal: AbortSignal): Promise<void> {
  await connectAndRun(params, signal, async (client) => {
    await client.list();
  });
}

/**
 * 写路径：按 UID 增删 \Seen 标志（标记已读/未读）。
 * 与只读函数分开：这里用 readOnly:false 打开邮箱，执行 STORE FLAGS。返回请求标记的数量。
 */
export async function markMessagesSeen(
  account: MailAccountConfig,
  mailbox: string,
  uids: number[],
  seen: boolean,
  signal: AbortSignal,
): Promise<number> {
  return connectAndRun(toConnParams(account), signal, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly: false });
    try {
      if (seen) {
        await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
      } else {
        await client.messageFlagsRemove(uids, ['\\Seen'], { uid: true });
      }
      return uids.length;
    } finally {
      lock.release();
    }
  });
}
