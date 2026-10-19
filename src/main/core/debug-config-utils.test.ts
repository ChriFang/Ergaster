import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDumpRequestEntry, formatLocalTimestamp, isDumpRequestEnabled, parseIni } from './debug-config-utils';

test('parseIni 解析标准 [Config] 节与 CRLF/BOM', () => {
  assert.deepEqual(parseIni('[Config]\ndumpReq=1\n'), { config: { dumpreq: '1' } });
  assert.deepEqual(parseIni('[Config]\r\ndumpReq=1\r\n'), { config: { dumpreq: '1' } });
  assert.deepEqual(parseIni('\uFEFF[Config]\ndumpReq=1'), { config: { dumpreq: '1' } });
});

test('parseIni 容忍节名与等号两侧空白', () => {
  assert.deepEqual(parseIni('[ Config ]\ndumpReq = 1\n'), { config: { dumpreq: '1' } });
});

test('parseIni 忽略 ; 与 # 注释行及空行', () => {
  assert.deepEqual(parseIni('; comment\n# comment\n\n[Config]\n; c\ndumpReq=1\n# c\n'), {
    config: { dumpreq: '1' },
  });
});

test('parseIni 节名与 key 归一为小写，value 保留原大小写', () => {
  assert.deepEqual(parseIni('[CONFIG]\nDumpReq=1\nenv=ProdX\n'), {
    config: { dumpreq: '1', env: 'ProdX' },
  });
});

test('parseIni 支持多节，value 中的等号不截断', () => {
  assert.deepEqual(parseIni('[Config]\na=1\n[Other]\nB=2\nurl=http://x?a=1\n'), {
    config: { a: '1' },
    other: { b: '2', url: 'http://x?a=1' },
  });
});

test('parseIni 节外 key 忽略、重复 key 后者覆盖、非法行跳过', () => {
  assert.deepEqual(parseIni('dumpReq=1\n[Config]\nother=2\n'), { config: { other: '2' } });
  assert.deepEqual(parseIni('[Config]\ndumpReq=0\ndumpReq=1\n'), { config: { dumpreq: '1' } });
  assert.deepEqual(parseIni('[Config]\nnoequals\n=valuedumped\ndumpReq=1\n'), {
    config: { dumpreq: '1' },
  });
});

test('isDumpRequestEnabled 仅在 Config 节 dumpReq 值为 1 时开启', () => {
  assert.equal(isDumpRequestEnabled(null), false);
  assert.equal(isDumpRequestEnabled({}), false);
  assert.equal(isDumpRequestEnabled({ config: { dumpreq: '0' } }), false);
  assert.equal(isDumpRequestEnabled({ config: { dumpreq: '2' } }), false);
  assert.equal(isDumpRequestEnabled({ other: { dumpreq: '1' } }), false);
  assert.equal(isDumpRequestEnabled({ config: { dumpreq: '1' } }), true);
  // 值的 trim 由 parseIni 负责，isDumpRequestEnabled 只做严格比较
  assert.equal(isDumpRequestEnabled({ config: { dumpreq: ' 1 ' } }), false);
});

test('formatLocalTimestamp 按本机时区渲染且与 UTC 时刻等价', () => {
  const date = new Date(Date.UTC(2026, 8, 28, 6, 46, 41, 650));
  const formatted = formatLocalTimestamp(date);
  assert.match(formatted, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}$/);

  // 无论运行机器处于哪个时区：本地时间 + 偏移量 还原后必须是同一 UTC 时刻
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3}) ([+-])(\d{2}):(\d{2})$/.exec(formatted);
  assert.ok(match);
  const [, y, mo, d, h, mi, s, ms, sign, oh, om] = match;
  const offsetMs = (Number(oh) * 60 + Number(om)) * 60_000 * (sign === '+' ? 1 : -1);
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms)) - offsetMs;
  assert.equal(utcMs, date.getTime());
});

test('formatDumpRequestEntry 含方法/URL/头/body 且 Authorization 脱敏', () => {
  const entry = formatDumpRequestEntry({
    seq: 3,
    timestamp: '2026-09-28 14:46:41.650 +08:00',
    retryLabel: 'Stream chat completion request',
    url: 'https://api.example.com/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-secret-key',
    },
    body: '{"model":"deepseek-v4","messages":[]}',
  });

  assert.match(entry, /^=== dump #3 \[2026-09-28 14:46:41\.650 \+08:00\] Stream chat completion request ===\n/);
  assert.ok(entry.includes('POST https://api.example.com/v1/chat/completions\n'));
  assert.ok(entry.includes('Content-Type: application/json\n'));
  assert.ok(entry.includes('Authorization: Bearer ***\n'));
  assert.ok(!entry.includes('sk-secret-key'));
  assert.ok(entry.includes('--- body ---\n{"model":"deepseek-v4","messages":[]}\n'));
  assert.ok(entry.endsWith('\n'));
});
