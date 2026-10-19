import { z } from 'zod';
import type { ToolContext, ToolResult } from '../../shared/tools';
import { MAIL_LIST_LIMIT_DEFAULT, MAIL_LIST_LIMIT_MAX } from '../../shared/mail';
import { mailAccountService } from './mail-account-service';
import { listMailboxes, listMessages, markMessagesSeen, readMessage, searchMessages } from './imap-client';
import { formatFolderList, formatMarkResult, formatMessageDetail, formatMessageList, appendAutoSeenNote } from './mail-format';

const NO_ACCOUNT_HINT = '尚未配置邮箱账户。请在「设置 → 邮箱账户」中添加 IMAP 账户后再试。';
const DEFAULT_MAILBOX = 'INBOX';

const accountIdField = z.string().trim().max(200).optional();
const mailboxField = z.string().trim().min(1).max(200).optional();
const limitField = z.number().int().min(1).max(MAIL_LIST_LIMIT_MAX).optional();
const searchTextField = z.string().trim().max(200).optional();

export const emailListMailboxesSchema = z.object({
  accountId: accountIdField,
});

export const emailListMessagesSchema = z.object({
  accountId: accountIdField,
  mailbox: mailboxField,
  limit: limitField,
});

export const emailSearchSchema = z.object({
  accountId: accountIdField,
  mailbox: mailboxField,
  from: searchTextField,
  to: searchTextField,
  subject: searchTextField,
  body: searchTextField,
  text: searchTextField,
  seen: z.boolean().optional(),
  since: z.string().trim().max(40).optional(),
  before: z.string().trim().max(40).optional(),
  limit: limitField,
});

export const emailReadMessageSchema = z.object({
  accountId: accountIdField,
  mailbox: mailboxField,
  uid: z.number().int().min(1),
});

const uidsField = z.array(z.number().int().min(1)).min(1).max(MAIL_LIST_LIMIT_MAX);

export const emailMarkReadSchema = z.object({
  accountId: accountIdField,
  mailbox: mailboxField,
  uids: uidsField,
});

export const emailMarkUnreadSchema = z.object({
  accountId: accountIdField,
  mailbox: mailboxField,
  uids: uidsField,
});

function fail(message: string): ToolResult {
  return { ok: false, content: message, error: message };
}

async function guard(context: ToolContext, run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    if (context.signal.aborted) {
      return fail('邮件操作已取消。');
    }
    const message = error instanceof Error ? error.message : '邮件操作失败。';
    return fail(`邮件操作失败：${message}`);
  }
}

export async function emailListMailboxes(
  args: z.infer<typeof emailListMailboxesSchema>,
  context: ToolContext,
): Promise<ToolResult> {
  const account = await mailAccountService.resolveAccount(args.accountId);
  if (!account) {
    return fail(args.accountId ? `未找到邮箱账户：${args.accountId}` : NO_ACCOUNT_HINT);
  }
  return guard(context, async () => {
    const folders = await listMailboxes(account, context.signal);
    return { ok: true, content: formatFolderList(folders), data: { account: account.label, folders } };
  });
}

export async function emailListMessages(
  args: z.infer<typeof emailListMessagesSchema>,
  context: ToolContext,
): Promise<ToolResult> {
  const account = await mailAccountService.resolveAccount(args.accountId);
  if (!account) {
    return fail(args.accountId ? `未找到邮箱账户：${args.accountId}` : NO_ACCOUNT_HINT);
  }
  return guard(context, async () => {
    const mailbox = args.mailbox ?? DEFAULT_MAILBOX;
    const limit = args.limit ?? MAIL_LIST_LIMIT_DEFAULT;
    const items = await listMessages(account, mailbox, limit, context.signal);
    return { ok: true, content: formatMessageList(mailbox, items), data: { account: account.label, mailbox, messages: items } };
  });
}

export async function emailSearch(
  args: z.infer<typeof emailSearchSchema>,
  context: ToolContext,
): Promise<ToolResult> {
  const account = await mailAccountService.resolveAccount(args.accountId);
  if (!account) {
    return fail(args.accountId ? `未找到邮箱账户：${args.accountId}` : NO_ACCOUNT_HINT);
  }
  return guard(context, async () => {
    const mailbox = args.mailbox ?? DEFAULT_MAILBOX;
    const limit = args.limit ?? MAIL_LIST_LIMIT_DEFAULT;
    const items = await searchMessages(
      account,
      mailbox,
      { from: args.from, to: args.to, subject: args.subject, body: args.body, text: args.text, seen: args.seen, since: args.since, before: args.before },
      limit,
      context.signal,
    );
    return { ok: true, content: formatMessageList(mailbox, items), data: { account: account.label, mailbox, messages: items } };
  });
}

export async function emailReadMessage(
  args: z.infer<typeof emailReadMessageSchema>,
  context: ToolContext,
): Promise<ToolResult> {
  const account = await mailAccountService.resolveAccount(args.accountId);
  if (!account) {
    return fail(args.accountId ? `未找到邮箱账户：${args.accountId}` : NO_ACCOUNT_HINT);
  }
  return guard(context, async () => {
    const mailbox = args.mailbox ?? DEFAULT_MAILBOX;
    const detail = await readMessage(account, mailbox, args.uid, context.signal);
    // 读取后一律自动标记已读（仅在未读时写）；标记失败尽力而为、不影响读取结果。
    let markNote = '';
    if (!detail.seen) {
      try {
        await markMessagesSeen(account, mailbox, [detail.uid], true, context.signal);
        detail.seen = true;
      } catch (error) {
        markNote = appendAutoSeenNote(error instanceof Error ? error.message : '未知原因');
      }
    }
    return { ok: true, content: `${formatMessageDetail(detail)}${markNote}`, data: { account: account.label, mailbox, message: detail } };
  });
}

async function markSeen(
  args: z.infer<typeof emailMarkReadSchema>,
  context: ToolContext,
  seen: boolean,
): Promise<ToolResult> {
  const account = await mailAccountService.resolveAccount(args.accountId);
  if (!account) {
    return fail(args.accountId ? `未找到邮箱账户：${args.accountId}` : NO_ACCOUNT_HINT);
  }
  return guard(context, async () => {
    const mailbox = args.mailbox ?? DEFAULT_MAILBOX;
    const count = await markMessagesSeen(account, mailbox, args.uids, seen, context.signal);
    return { ok: true, content: formatMarkResult(mailbox, count, seen), data: { account: account.label, mailbox, uids: args.uids, seen } };
  });
}

export async function emailMarkRead(
  args: z.infer<typeof emailMarkReadSchema>,
  context: ToolContext,
): Promise<ToolResult> {
  return markSeen(args, context, true);
}

export async function emailMarkUnread(
  args: z.infer<typeof emailMarkUnreadSchema>,
  context: ToolContext,
): Promise<ToolResult> {
  return markSeen(args, context, false);
}
