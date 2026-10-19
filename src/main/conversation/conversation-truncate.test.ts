import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatCompletionApiMessage } from '../agent/deepseek-client';
import { truncateMessagesFromId } from './conversation-truncate';

function history(): ChatCompletionApiMessage[] {
  return [
    { id: 'u1', role: 'user', content: '第一问' },
    { id: 'a1', role: 'assistant', content: '第一答' },
    { id: 'u2', role: 'user', content: '第二问' },
    { id: 'a2', role: 'assistant', content: '第二答' },
  ];
}

test('truncateMessagesFromId 保留目标消息之前的内容', () => {
  const result = truncateMessagesFromId(history(), 'a2');
  assert.deepEqual(result?.map((message) => message.id), ['u1', 'a1', 'u2']);
});

test('truncateMessagesFromId 以 user 消息为截断点时删除该提问及其后内容', () => {
  const result = truncateMessagesFromId(history(), 'u2');
  assert.deepEqual(result?.map((message) => message.id), ['u1', 'a1']);
});

test('truncateMessagesFromId 未命中返回 null', () => {
  assert.equal(truncateMessagesFromId(history(), 'missing'), null);
  assert.equal(truncateMessagesFromId(history(), ''), null);
});

test('truncateMessagesFromId 截断到会话开头返回空数组', () => {
  const result = truncateMessagesFromId(history(), 'u1');
  assert.deepEqual(result, []);
});

test('truncateMessagesFromId 空历史未命中返回 null', () => {
  assert.equal(truncateMessagesFromId([], 'u1'), null);
});

test('truncateMessagesFromId 不修改原数组', () => {
  const original = history();
  truncateMessagesFromId(original, 'a1');
  assert.equal(original.length, 4);
  assert.equal(original[3].id, 'a2');
});
