import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentMessage } from '../../../shared/agent';
import type { WorkflowStreamEvent } from '../../../shared/workflow';
import { appendWorkflowStreamDelta } from './workflow-stream';

function delta(overrides: Partial<WorkflowStreamEvent> = {}): WorkflowStreamEvent {
  return {
    runId: 'run-1',
    type: 'message_delta',
    streamMessageId: 'msg-1',
    deltaContent: '内容',
    ...overrides,
  };
}

test('appendWorkflowStreamDelta 缺省按 assistant 角色新建消息', () => {
  const messages = appendWorkflowStreamDelta([], delta());

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, 'assistant');
  assert.equal(messages[0]?.content, '内容');
});

test('appendWorkflowStreamDelta 按事件角色落成 tool 消息，避免工具结果被当成正文铺开', () => {
  const messages = appendWorkflowStreamDelta([], delta({
    role: 'tool',
    deltaContent: '{"ok":true,"content":"请求地址: https://example.com"}',
  }));

  assert.equal(messages[0]?.role, 'tool');
});

test('appendWorkflowStreamDelta 对已存在的消息只追加内容，不改角色', () => {
  const existing: AgentMessage[] = [{ id: 'msg-1', role: 'tool', content: 'A' }];
  const messages = appendWorkflowStreamDelta(existing, delta({ role: 'tool', deltaContent: 'B' }));

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, 'tool');
  assert.equal(messages[0]?.content, 'AB');
});

test('appendWorkflowStreamDelta 忽略没有内容或缺少 streamMessageId 的事件', () => {
  assert.deepEqual(appendWorkflowStreamDelta([], delta({ deltaContent: undefined })), []);
  assert.deepEqual(appendWorkflowStreamDelta([], delta({ streamMessageId: undefined })), []);
});
