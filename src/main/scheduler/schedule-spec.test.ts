import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduleSpec, computeNextRunAt, parseLocalDateTime, parseScheduleSpec } from './schedule-spec';

/** 固定基准时间：2026-09-22（周二）10:30 本地时间。 */
function baseTime() {
  return new Date(2026, 8, 22, 10, 30, 0, 0);
}

test('parseLocalDateTime 按本地时区解析不带时区的时间', () => {
  const parsed = parseLocalDateTime('2026-09-22T15:30');
  assert.ok(parsed);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 8);
  assert.equal(parsed.getDate(), 22);
  assert.equal(parsed.getHours(), 15);
  assert.equal(parsed.getMinutes(), 30);
});

test('computeNextRunAt once 未来时间返回该时间，过期返回 null', () => {
  const future = computeNextRunAt({ kind: 'once', runAt: '2026-09-22T15:30' }, baseTime());
  assert.equal(future?.getHours(), 15);
  assert.equal(computeNextRunAt({ kind: 'once', runAt: '2026-09-22T09:00' }, baseTime()), null);
});

test('computeNextRunAt daily 当天时点已过则顺延到次日', () => {
  const later = computeNextRunAt({ kind: 'daily', hour: 23, minute: 0 }, baseTime());
  assert.equal(later?.getDate(), 22);
  assert.equal(later?.getHours(), 23);

  const nextDay = computeNextRunAt({ kind: 'daily', hour: 9, minute: 0 }, baseTime());
  assert.equal(nextDay?.getDate(), 23);
  assert.equal(nextDay?.getHours(), 9);
});

test('computeNextRunAt weekly 跨周计算，同日时点已过则顺延一周', () => {
  // 基准是周二，目标周五
  const friday = computeNextRunAt({ kind: 'weekly', weekday: 5, hour: 9, minute: 0 }, baseTime());
  assert.equal(friday?.getDay(), 5);
  assert.equal(friday?.getDate(), 25);

  // 同为周二但时点已过 -> 下周二
  const nextTuesday = computeNextRunAt({ kind: 'weekly', weekday: 2, hour: 9, minute: 0 }, baseTime());
  assert.equal(nextTuesday?.getDay(), 2);
  assert.equal(nextTuesday?.getDate(), 29);

  // 同为周二且时点未到 -> 当天
  const today = computeNextRunAt({ kind: 'weekly', weekday: 2, hour: 18, minute: 0 }, baseTime());
  assert.equal(today?.getDate(), 22);
});

test('computeNextRunAt interval 以 from 为基准前移，错过的那次不补跑', () => {
  const from = baseTime();
  const next = computeNextRunAt({ kind: 'interval', minutes: 30 }, from);
  assert.equal(next?.getTime(), from.getTime() + 30 * 60_000);
});

test('parseScheduleSpec 丢弃字段越界或未知类型的记录', () => {
  assert.deepEqual(parseScheduleSpec({ kind: 'daily', hour: 9, minute: 5 }), { kind: 'daily', hour: 9, minute: 5 });
  assert.equal(parseScheduleSpec({ kind: 'daily', hour: 24, minute: 0 }), null);
  assert.equal(parseScheduleSpec({ kind: 'weekly', weekday: 7, hour: 1, minute: 0 }), null);
  assert.equal(parseScheduleSpec({ kind: 'interval', minutes: 1 }), null);
  assert.equal(parseScheduleSpec({ kind: 'cron', expression: '* * * * *' }), null);
  assert.equal(parseScheduleSpec(null), null);
});

test('buildScheduleSpec 缺参数或过去时间时给出明确错误', () => {
  assert.deepEqual(buildScheduleSpec({ schedule_kind: 'daily', hour: 9, minute: 0 }, baseTime()), {
    ok: true,
    spec: { kind: 'daily', hour: 9, minute: 0 },
  });

  const missingHour = buildScheduleSpec({ schedule_kind: 'daily' }, baseTime());
  assert.equal(missingHour.ok, false);

  const past = buildScheduleSpec({ schedule_kind: 'once', run_at: '2026-09-22T09:00' }, baseTime());
  assert.equal(past.ok, false);

  const tooFrequent = buildScheduleSpec({ schedule_kind: 'interval', interval_minutes: 1 }, baseTime());
  assert.equal(tooFrequent.ok, false);
});
