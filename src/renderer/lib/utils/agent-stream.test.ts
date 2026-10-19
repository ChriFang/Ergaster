import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentStreamEvent } from '../../../shared/agent';
import { matchesStreamEventConversation } from './agent-stream';

test('matchesStreamEventConversation 事件会话与当前会话一致时通过', () => {
  const event: AgentStreamEvent = { conversationId: 'c1', streamMessageId: 'm1', deltaContent: 'x' };
  assert.equal(matchesStreamEventConversation(event, 'c1'), true);
});

test('matchesStreamEventConversation 事件属于其他会话时拦截', () => {
  const event: AgentStreamEvent = { conversationId: 'c2', streamMessageId: 'm1', deltaContent: 'x' };
  assert.equal(matchesStreamEventConversation(event, 'c1'), false);
  assert.equal(matchesStreamEventConversation(event, null), false);
});

test('matchesStreamEventConversation 缺省 conversationId 的旧事件回退放行', () => {
  const event: AgentStreamEvent = { streamMessageId: 'm1', deltaContent: 'x' };
  assert.equal(matchesStreamEventConversation(event, 'c1'), true);
  assert.equal(matchesStreamEventConversation(event, null), true);
});
