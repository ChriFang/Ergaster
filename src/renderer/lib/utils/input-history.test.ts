import assert from 'node:assert/strict';
import test from 'node:test';

// pure Node 测试环境没有 window/localStorage，注入内存版垫片（模块内在调用时才读 window）
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  },
};

import { MAX_INPUT_HISTORY, clearInputHistory, readInputHistory, recordInput } from './input-history';

test('未知会话读到空数组', () => {
  assert.deepEqual(readInputHistory('nope'), []);
});

test('记录后按时间顺序读回（最新在末尾）', () => {
  const cid = 'c1';
  recordInput(cid, 'a');
  recordInput(cid, 'b');
  assert.deepEqual(readInputHistory(cid), ['a', 'b']);
});

test('连续重复只记一条，非连续重复照记', () => {
  const cid = 'c2';
  recordInput(cid, 'x');
  recordInput(cid, 'x'); // 连续重复跳过
  recordInput(cid, 'y');
  recordInput(cid, 'x'); // 非连续，照记
  assert.deepEqual(readInputHistory(cid), ['x', 'y', 'x']);
});

test('空白输入不记录', () => {
  const cid = 'c3';
  recordInput(cid, '   ');
  recordInput(cid, '');
  assert.deepEqual(readInputHistory(cid), []);
});

test('记录做 trim', () => {
  const cid = 'c4';
  recordInput(cid, '  hi  ');
  assert.deepEqual(readInputHistory(cid), ['hi']);
});

test('超出上限从最早侧截断', () => {
  const cid = 'c5';
  for (let i = 0; i < MAX_INPUT_HISTORY + 10; i += 1) {
    recordInput(cid, `m${i}`);
  }
  const history = readInputHistory(cid);
  assert.equal(history.length, MAX_INPUT_HISTORY);
  assert.equal(history[0], 'm10'); // 前 10 条被截断
  assert.equal(history[history.length - 1], `m${MAX_INPUT_HISTORY + 9}`);
});

test('clearInputHistory 清除该会话记录，不影响其它会话', () => {
  recordInput('c6', 'keep');
  recordInput('c7', 'gone');
  clearInputHistory('c7');
  assert.deepEqual(readInputHistory('c7'), []);
  assert.deepEqual(readInputHistory('c6'), ['keep']);
});
