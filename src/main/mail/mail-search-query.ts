/** 纯逻辑：把邮件搜索工具的入参映射为 imapflow 的 search 条件对象。不依赖 imapflow 运行时。 */

export type MailSearchArgs = {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  text?: string;
  seen?: boolean;
  since?: string;
  before?: string;
};

/** imapflow SearchObject 的结构化子集（字段名与 imapflow 对齐，便于直接透传）。 */
export type ImapSearchQuery = {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  text?: string;
  seen?: boolean;
  since?: Date;
  before?: Date;
  all?: boolean;
};

function cleanText(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 解析 YYYY-MM-DD 或 ISO 日期串；非法返回 null。 */
export function parseSearchDate(value: string | undefined): Date | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return null;
  }
  const timestamp = Date.parse(trimmed);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

/** 构造 imapflow search 条件。无任何条件时回退为 { all: true }。 */
export function buildImapSearch(args: MailSearchArgs): ImapSearchQuery {
  const query: ImapSearchQuery = {};

  const from = cleanText(args.from);
  const to = cleanText(args.to);
  const subject = cleanText(args.subject);
  const body = cleanText(args.body);
  const text = cleanText(args.text);

  if (from) query.from = from;
  if (to) query.to = to;
  if (subject) query.subject = subject;
  if (body) query.body = body;
  if (text) query.text = text;
  if (typeof args.seen === 'boolean') query.seen = args.seen;

  const since = parseSearchDate(args.since);
  const before = parseSearchDate(args.before);
  if (since) query.since = since;
  if (before) query.before = before;

  if (Object.keys(query).length === 0) {
    query.all = true;
  }

  return query;
}
