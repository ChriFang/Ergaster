import assert from 'node:assert/strict';
import test from 'node:test';
import { formatElapsed, formatTokenCount } from './format-metrics';

test('formatElapsed 一分钟内只显示秒', () => {
  assert.equal(formatElapsed(0), '0 秒');
  assert.equal(formatElapsed(999), '0 秒');
  assert.equal(formatElapsed(12_400), '12 秒');
  assert.equal(formatElapsed(59_999), '59 秒');
});

test('formatElapsed 超过一分钟显示分秒并补零', () => {
  assert.equal(formatElapsed(60_000), '1 分 00 秒');
  assert.equal(formatElapsed(83_000), '1 分 23 秒');
  assert.equal(formatElapsed(59 * 60_000 + 59_000), '59 分 59 秒');
});

test('formatElapsed 超过一小时显示时分', () => {
  assert.equal(formatElapsed(3_600_000), '1 小时 00 分');
  assert.equal(formatElapsed(3_600_000 + 5 * 60_000), '1 小时 05 分');
  assert.equal(formatElapsed(2 * 3_600_000 + 30 * 60_000), '2 小时 30 分');
});

test('formatElapsed 对负数按 0 处理', () => {
  assert.equal(formatElapsed(-5000), '0 秒');
});

test('formatTokenCount 一万以内显示原值', () => {
  assert.equal(formatTokenCount(0), '0');
  assert.equal(formatTokenCount(980), '980');
  assert.equal(formatTokenCount(9999), '9999');
});

test('formatTokenCount 一万以上折算 k，百万以上折算 M', () => {
  assert.equal(formatTokenCount(10_000), '10.0k');
  assert.equal(formatTokenCount(123_456), '123.5k');
  assert.equal(formatTokenCount(1_234_567), '1.23M');
});

test('formatTokenCount 对负数与小数做规整', () => {
  assert.equal(formatTokenCount(-100), '0');
  assert.equal(formatTokenCount(12.6), '13');
});
