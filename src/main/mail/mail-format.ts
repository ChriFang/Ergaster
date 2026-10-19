/** 纯逻辑：把邮件信封/正文/文件夹格式化为工具返回的可读文本。不依赖 Node / imapflow。 */
import type { MailFolder, MailMessageDetail, MailMessageSummary } from '../../shared/mail';
import { MAIL_BODY_MAX_CHARS } from '../../shared/mail';

/** 截断正文并归一化换行，返回是否发生截断。 */
export function truncateBody(text: string | undefined, max = MAIL_BODY_MAX_CHARS): { text: string; truncated: boolean } {
  const normalized = (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (normalized.length <= max) {
    return { text: normalized, truncated: false };
  }
  return { text: normalized.slice(0, max), truncated: true };
}

function formatSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return '未知大小';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** 文件夹列表 → 文本。 */
export function formatFolderList(folders: MailFolder[]): string {
  if (folders.length === 0) {
    return '该账户下没有可见的邮箱文件夹。';
  }
  const lines = folders.map((folder) => {
    const special = folder.specialUse ? `（${folder.specialUse}）` : '';
    return `- ${folder.path}${special}`;
  });
  return `共 ${folders.length} 个邮箱文件夹：\n${lines.join('\n')}`;
}

/** 信封摘要列表 → 文本。 */
export function formatMessageList(mailbox: string, items: MailMessageSummary[]): string {
  if (items.length === 0) {
    return `邮箱 ${mailbox} 没有匹配的邮件。`;
  }
  const lines = items.map((item, index) => {
    const marks = [item.seen ? '已读' : '未读'];
    if (item.hasAttachments) {
      marks.push('含附件');
    }
    return `${index + 1}. [${marks.join('/')}] ${item.subject || '(无主题)'} — ${item.from || '(未知发件人)'} — ${item.date} — UID ${item.uid}`;
  });
  return `邮箱 ${mailbox} 返回 ${items.length} 封邮件（按时间倒序）：\n${lines.join('\n')}`;
}

/** 单封邮件详情 → 文本。 */
export function formatMessageDetail(detail: MailMessageDetail): string {
  const header = [
    `主题：${detail.subject || '(无主题)'}`,
    `发件人：${detail.from || '(未知)'}`,
    detail.to.length > 0 ? `收件人：${detail.to.join(', ')}` : null,
    detail.cc.length > 0 ? `抄送：${detail.cc.join(', ')}` : null,
    `日期：${detail.date}`,
    `状态：${detail.seen ? '已读' : '未读'}`,
    `UID：${detail.uid}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  const attachments = detail.attachments.length > 0
    ? `\n\n附件（${detail.attachments.length}）：\n${detail.attachments
      .map((item, index) => `${index + 1}. ${item.filename || '(未命名)'} — ${item.contentType || '未知类型'} — ${formatSize(item.size)}`)
      .join('\n')}`
    : '\n\n（无附件）';

  const body = `\n\n正文：\n${detail.text || '(空)'}${detail.truncated ? '\n…（正文已截断）' : ''}`;

  return `${header}${body}${attachments}`;
}

/** 标记已读/未读结果 → 文本。措辞为"已请求"，不谎报逐封成功（服务端会忽略不存在的 UID）。 */
export function formatMarkResult(mailbox: string, count: number, seen: boolean): string {
  const action = seen ? '已读' : '未读';
  return `已请求将 ${count} 封邮件标记为${action}（邮箱 ${mailbox}）。`;
}

/** 读取邮件后自动标记已读失败时，追加到正文末尾的提示片段。 */
export function appendAutoSeenNote(reason: string): string {
  return `\n\n（自动标记已读失败：${reason}）`;
}
