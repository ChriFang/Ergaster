import { z } from 'zod';
import type { ToolDefinition } from '../../shared/tools';
import { mailToolTimeoutMs } from '../../shared/tools';
import {
  emailListMailboxes,
  emailListMailboxesSchema,
  emailListMessages,
  emailListMessagesSchema,
  emailMarkRead,
  emailMarkReadSchema,
  emailMarkUnread,
  emailMarkUnreadSchema,
  emailReadMessage,
  emailReadMessageSchema,
  emailSearch,
  emailSearchSchema,
} from './mail-tools';

/**
 * 邮件工具定义。原先内联在 tool-registry 的 registeredTools 里，现随邮件能力模块一起出列，
 * 由 mailCapability.getTools() 按 config.mailEnabled 门控注入。execute/schema 仍来自 mail-tools。
 */
export const mailToolDefinitions: ToolDefinition<unknown>[] = [
  {
    name: 'email_list_mailboxes',
    description: '列出已配置邮箱账户下的邮箱/文件夹（只读，不改变任何邮件状态）。可选 accountId 指定账户，缺省用默认账户。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: '邮箱账户 id 或名称；缺省使用默认账户' },
      },
      required: [],
      additionalProperties: false,
    },
    validator: emailListMailboxesSchema,
    timeoutMs: mailToolTimeoutMs,
    source: { type: 'system' },
    execute: async (args, context) => emailListMailboxes(args as z.infer<typeof emailListMailboxesSchema>, context),
  },
  {
    name: 'email_list_messages',
    description: '读取/查看邮箱收件箱里最近的邮件，返回主题、发件人、时间等信封摘要（只读，不会标记已读）。当用户想“看邮件 / 查收件箱 / 最近邮件 / 今天的邮件 / 有没有新邮件”时，用本工具真实读取用户已配置的邮箱，不要改用命令行或其他工具代替。默认邮箱 INBOX。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: '邮箱账户 id 或名称；缺省使用默认账户' },
        mailbox: { type: 'string', description: '邮箱/文件夹路径，缺省为 INBOX' },
        limit: { type: 'number', description: '返回条数，默认 20，最多 50' },
      },
      required: [],
      additionalProperties: false,
    },
    validator: emailListMessagesSchema,
    timeoutMs: mailToolTimeoutMs,
    source: { type: 'system' },
    execute: async (args, context) => emailListMessages(args as z.infer<typeof emailListMessagesSchema>, context),
  },
  {
    name: 'email_search',
    description: '在邮箱中按发件人/收件人/主题/正文/关键字/时间范围/是否已读搜索邮件，返回信封摘要（只读）。当用户想“查未读邮件、某人发来的邮件、含某关键词或主题的邮件、某时间段的邮件”时使用；查“未读邮件”传 seen=false。默认邮箱 INBOX。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: '邮箱账户 id 或名称；缺省使用默认账户' },
        mailbox: { type: 'string', description: '邮箱/文件夹路径，缺省为 INBOX' },
        from: { type: 'string', description: '匹配发件人（From）' },
        to: { type: 'string', description: '匹配收件人（To）' },
        subject: { type: 'string', description: '匹配主题' },
        body: { type: 'string', description: '匹配正文' },
        text: { type: 'string', description: '匹配任意头部或正文文本' },
        seen: { type: 'boolean', description: 'true 只看已读，false 只看未读' },
        since: { type: 'string', description: '起始日期，如 2026-09-01（含当日之后）' },
        before: { type: 'string', description: '截止日期，如 2026-09-30（该日之前）' },
        limit: { type: 'number', description: '返回条数，默认 20，最多 50' },
      },
      required: [],
      additionalProperties: false,
    },
    validator: emailSearchSchema,
    timeoutMs: mailToolTimeoutMs,
    source: { type: 'system' },
    execute: async (args, context) => emailSearch(args as z.infer<typeof emailSearchSchema>, context),
  },
  {
    name: 'email_read_message',
    description: '按 UID 读取单封邮件的正文与附件元信息，读取后会自动把该邮件标记为已读。当用户想“打开/阅读/查看某封邮件的内容”时，先用 email_list_messages 或 email_search 拿到 UID，再用本工具读取。若只想查看列表而不改变已读状态，请改用 email_list_messages / email_search（它们只读）。默认邮箱 INBOX。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: '邮箱账户 id 或名称；缺省使用默认账户' },
        mailbox: { type: 'string', description: '邮箱/文件夹路径，缺省为 INBOX' },
        uid: { type: 'number', description: '邮件的 UID（来自列表/搜索结果）' },
      },
      required: ['uid'],
      additionalProperties: false,
    },
    validator: emailReadMessageSchema,
    timeoutMs: mailToolTimeoutMs,
    source: { type: 'system' },
    execute: async (args, context) => emailReadMessage(args as z.infer<typeof emailReadMessageSchema>, context),
  },
  {
    name: 'email_mark_read',
    description: '将指定 UID 的邮件标记为已读（会修改邮箱状态，添加 \\Seen 标志）。先用 email_list_messages / email_search 获取 UID。默认邮箱 INBOX。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: '邮箱账户 id 或名称；缺省使用默认账户' },
        mailbox: { type: 'string', description: '邮箱/文件夹路径，缺省为 INBOX' },
        uids: { type: 'array', items: { type: 'number' }, description: '要标记为已读的邮件 UID 列表（来自列表/搜索结果），最多 50 个' },
      },
      required: ['uids'],
      additionalProperties: false,
    },
    validator: emailMarkReadSchema,
    timeoutMs: mailToolTimeoutMs,
    source: { type: 'system' },
    buildConfirmation: async (args) => {
      const input = args as z.infer<typeof emailMarkReadSchema>;
      return { summary: `将把 ${input.uids.length} 封邮件标记为已读（邮箱 ${input.mailbox ?? 'INBOX'}）` };
    },
    execute: async (args, context) => emailMarkRead(args as z.infer<typeof emailMarkReadSchema>, context),
  },
  {
    name: 'email_mark_unread',
    description: '将指定 UID 的邮件标记为未读（会修改邮箱状态，移除 \\Seen 标志）。可用于撤销误标的已读。默认邮箱 INBOX。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: '邮箱账户 id 或名称；缺省使用默认账户' },
        mailbox: { type: 'string', description: '邮箱/文件夹路径，缺省为 INBOX' },
        uids: { type: 'array', items: { type: 'number' }, description: '要标记为未读的邮件 UID 列表（来自列表/搜索结果），最多 50 个' },
      },
      required: ['uids'],
      additionalProperties: false,
    },
    validator: emailMarkUnreadSchema,
    timeoutMs: mailToolTimeoutMs,
    source: { type: 'system' },
    buildConfirmation: async (args) => {
      const input = args as z.infer<typeof emailMarkUnreadSchema>;
      return { summary: `将把 ${input.uids.length} 封邮件标记为未读（邮箱 ${input.mailbox ?? 'INBOX'}）` };
    },
    execute: async (args, context) => emailMarkUnread(args as z.infer<typeof emailMarkUnreadSchema>, context),
  },
];

