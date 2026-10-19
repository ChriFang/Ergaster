import assert from 'node:assert/strict';
import test from 'node:test';
import type { MailMessageDetail, MailMessageSummary } from '../../shared/mail';
import { appendAutoSeenNote, formatFolderList, formatMarkResult, formatMessageDetail, formatMessageList, truncateBody } from './mail-format';

test('truncateBody 归一化换行且短文本不截断', () => {
  const result = truncateBody('a\r\nb\r\n');
  assert.equal(result.text, 'a\nb');
  assert.equal(result.truncated, false);
});

test('truncateBody 超长时截断并标记', () => {
  const long = 'x'.repeat(20_000);
  const result = truncateBody(long, 100);
  assert.equal(result.text.length, 100);
  assert.equal(result.truncated, true);
});

test('formatMessageList 空与非空', () => {
  assert.match(formatMessageList('INBOX', []), /没有匹配的邮件/);

  const items: MailMessageSummary[] = [
    { uid: 12, subject: '周报', from: 'a@x.com', date: '2026-09-10', seen: false, hasAttachments: true },
  ];
  const text = formatMessageList('INBOX', items);
  assert.match(text, /未读/);
  assert.match(text, /含附件/);
  assert.match(text, /UID 12/);
  assert.match(text, /周报/);
});

test('formatMessageDetail 含附件与截断标记', () => {
  const detail: MailMessageDetail = {
    uid: 5,
    subject: 'Hi',
    from: 'a@x.com',
    to: ['b@x.com'],
    cc: [],
    date: '2026-09-10',
    seen: true,
    text: '正文内容',
    truncated: true,
    attachments: [{ filename: 'r.pdf', contentType: 'application/pdf', size: 2048 }],
  };
  const text = formatMessageDetail(detail);
  assert.match(text, /主题：Hi/);
  assert.match(text, /收件人：b@x.com/);
  assert.match(text, /附件（1）/);
  assert.match(text, /r\.pdf/);
  assert.match(text, /2\.0 KB/);
  assert.match(text, /正文已截断/);
});

test('formatMessageDetail 无附件与空正文', () => {
  const detail: MailMessageDetail = {
    uid: 6, subject: '', from: '', to: [], cc: [], date: '2026-09-10', seen: false, text: '', truncated: false, attachments: [],
  };
  const text = formatMessageDetail(detail);
  assert.match(text, /\(无主题\)/);
  assert.match(text, /（无附件）/);
  assert.match(text, /\(空\)/);
});

test('formatFolderList 空与非空', () => {
  assert.match(formatFolderList([]), /没有可见的邮箱/);
  const text = formatFolderList([
    { path: 'INBOX', name: 'INBOX', subscribed: true },
    { path: 'Sent', name: 'Sent', specialUse: '\\Sent', subscribed: true },
  ]);
  assert.match(text, /共 2 个/);
  assert.match(text, /INBOX/);
  assert.match(text, /\\Sent/);
});

test('formatMarkResult 已读/未读文案与数量', () => {
  const read = formatMarkResult('INBOX', 3, true);
  assert.match(read, /已请求将 3 封邮件标记为已读/);
  assert.match(read, /邮箱 INBOX/);

  const unread = formatMarkResult('Sent', 1, false);
  assert.match(unread, /标记为未读/);
  assert.match(unread, /1 封/);
});

test('appendAutoSeenNote 生成失败提示片段', () => {
  const note = appendAutoSeenNote('连接超时');
  assert.match(note, /自动标记已读失败：连接超时/);
  assert.ok(note.startsWith('\n\n'));
});
