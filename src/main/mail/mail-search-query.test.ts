import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImapSearch, parseSearchDate } from './mail-search-query';

test('buildImapSearch 无条件时回退为 all', () => {
  assert.deepEqual(buildImapSearch({}), { all: true });
  assert.deepEqual(buildImapSearch({ from: '   ', subject: '' }), { all: true });
});

test('buildImapSearch 裁剪文本并透传 seen 布尔', () => {
  const query = buildImapSearch({ from: ' boss@x.com ', subject: ' 报销 ', seen: false });
  assert.equal(query.from, 'boss@x.com');
  assert.equal(query.subject, '报销');
  assert.equal(query.seen, false);
  assert.equal(query.all, undefined);
});

test('buildImapSearch 解析 since/before，忽略非法日期', () => {
  const query = buildImapSearch({ since: '2026-09-01', before: 'not-a-date' });
  assert.ok(query.since instanceof Date);
  assert.equal(query.since?.getUTCFullYear(), 2026);
  assert.equal(query.before, undefined);
});

test('buildImapSearch seen=true 也保留', () => {
  assert.equal(buildImapSearch({ seen: true }).seen, true);
});

test('parseSearchDate 合法与非法', () => {
  assert.ok(parseSearchDate('2026-01-02') instanceof Date);
  assert.ok(parseSearchDate(' 2026-01-02T03:04:05Z ') instanceof Date);
  assert.equal(parseSearchDate('rubbish'), null);
  assert.equal(parseSearchDate(''), null);
  assert.equal(parseSearchDate(undefined), null);
});
