import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentMessage } from '../../../shared/agent';
import {
  computeTurnLastEntryKey,
  getFilePreviewKey,
  getSubagentPreviewText,
  groupFilePreviewsByTurnUserId,
  groupMessagesBySubagent,
  interleaveToolInvocations,
} from './message-model';

function subagentMessage(id: string, label: string, content: string, role: AgentMessage['role'] = 'assistant'): AgentMessage {
  return {
    id: `${id}-${role}-${content.slice(0, 6)}`,
    role,
    content,
    workflow: {
      runId: 'run-1',
      actorRole: 'researcher',
      subagent: { id, label, depth: 1 },
    },
  };
}

function plainMessage(id: string, content: string): AgentMessage {
  return { id, role: 'assistant', content };
}

test('groupMessagesBySubagent 保留非子智能体消息为独立条目', () => {
  const entries = groupMessagesBySubagent([plainMessage('m1', 'A'), plainMessage('m2', 'B')]);

  assert.deepEqual(entries.map((entry) => entry.kind), ['message', 'message']);
});

test('groupMessagesBySubagent 按 subagent.id 合并交错到达的并行消息', () => {
  const entries = groupMessagesBySubagent([
    plainMessage('m1', '派发前'),
    subagentMessage('sa-1', 'SQ1', 'SQ1 第一段'),
    subagentMessage('sa-2', 'SQ2', 'SQ2 第一段'),
    subagentMessage('sa-1', 'SQ1', '{"ok":true,"content":"SQ1 工具结果"}', 'tool'),
    subagentMessage('sa-2', 'SQ2', 'SQ2 结论'),
    plainMessage('m2', '汇总'),
  ]);

  assert.deepEqual(entries.map((entry) => entry.kind), ['message', 'subagent', 'subagent', 'message']);

  const first = entries[1];
  const second = entries[2];
  assert.equal(first?.kind, 'subagent');
  assert.equal(second?.kind, 'subagent');

  if (first?.kind !== 'subagent' || second?.kind !== 'subagent') {
    return;
  }

  // 分组位置取该子智能体第一条消息的位置，不受后续交错影响
  assert.equal(first.label, 'SQ1');
  assert.equal(first.items.length, 2);
  assert.equal(first.toolCount, 1);
  assert.equal(second.label, 'SQ2');
  assert.equal(second.items.length, 2);
  assert.equal(second.toolCount, 0);
});

test('groupMessagesBySubagent 用组内最后一条有内容的消息作为折叠预览', () => {
  const entries = groupMessagesBySubagent([
    subagentMessage('sa-1', 'SQ1', '中间输出'),
    subagentMessage('sa-1', 'SQ1', '最终结论'),
  ]);

  const group = entries[0];
  assert.equal(group?.kind, 'subagent');
  if (group?.kind !== 'subagent') {
    return;
  }

  assert.equal(group.previewText, '最终结论');
});

test('getSubagentPreviewText 解开工具消息载荷并压缩空白', () => {
  const preview = getSubagentPreviewText([
    {
      key: 'k1',
      index: 0,
      message: subagentMessage('sa-1', 'SQ1', '{"ok":true,"content":"第一行\\n\\n第二行"}', 'tool'),
    },
  ]);

  assert.equal(preview, '第一行 第二行');
});

test('getSubagentPreviewText 在还没有任何输出时给出占位文案', () => {
  const preview = getSubagentPreviewText([
    { key: 'k1', index: 0, message: subagentMessage('sa-1', 'SQ1', '   ') },
  ]);

  assert.equal(preview, '子智能体已派发，等待输出…');
});

test('getSubagentPreviewText 截断过长内容', () => {
  const long = 'x'.repeat(300);
  const preview = getSubagentPreviewText([
    { key: 'k1', index: 0, message: subagentMessage('sa-1', 'SQ1', long) },
  ]);

  assert.equal(preview.length, 161);
  assert.ok(preview.endsWith('…'));
});

test('getFilePreviewKey 同一轮内同名文件视为同一张卡片', () => {
  const base = { turnUserId: 'user-1', kind: 'image', path: 'E:/a.png', fileName: 'a.png' };

  assert.equal(getFilePreviewKey(base), getFilePreviewKey({ ...base }));
});

test('getFilePreviewKey 用 fileName 区分同一轮里无落盘路径的多张图', () => {
  const shared = { turnUserId: 'user-1', kind: 'image', path: '' };

  assert.notEqual(
    getFilePreviewKey({ ...shared, fileName: 'screenshot-1.png' }),
    getFilePreviewKey({ ...shared, fileName: 'screenshot-2.png' }),
  );
});

test('getFilePreviewKey 不同轮预览同一文件各自留一张卡片', () => {
  const base = { kind: 'image', path: 'E:/a.png', fileName: 'a.png' };

  assert.notEqual(
    getFilePreviewKey({ ...base, turnUserId: 'user-1' }),
    getFilePreviewKey({ ...base, turnUserId: 'user-2' }),
  );
});

test('groupFilePreviewsByTurnUserId 按轮次归组并跳过无 turnUserId 的卡片', () => {
  const grouped = groupFilePreviewsByTurnUserId([
    { turnUserId: 'user-1', kind: 'image', path: 'E:/a.png', fileName: 'a.png', id: 'k1' },
    { turnUserId: 'user-2', kind: 'text', path: 'E:/b.txt', fileName: 'b.txt', id: 'k2' },
    { turnUserId: 'user-1', kind: 'image', path: '', fileName: 'screenshot-1.png', id: 'k3' },
    { kind: 'image', path: 'E:/c.png', fileName: 'c.png', id: 'k4' },
  ]);

  assert.deepEqual([...grouped.keys()], ['user-1', 'user-2']);
  assert.deepEqual(grouped.get('user-1')?.map((item) => item.id), ['k1', 'k3']);
  assert.deepEqual(grouped.get('user-2')?.map((item) => item.id), ['k2']);
});

/** 构造 interleave 测试用的消息条目（kind: 'message' 形状与 MessageList 的 FlatMessageEntry 一致）。 */
function messageEntry(id: string | undefined, role: AgentMessage['role'], index: number) {
  const message: AgentMessage = { id, role, content: 'x' };
  return {
    kind: 'message' as const,
    item: { key: `${role}-${index}`, message, index },
  };
}

test('interleaveToolInvocations 按锚点助手消息把卡片插到对应条目之后', () => {
  const entries = [
    messageEntry('user-1', 'user', 0),
    messageEntry('assistant-1', 'assistant', 1),
    messageEntry('assistant-2', 'assistant', 2),
  ];
  const { invocationsByEntryIndex, unanchored } = interleaveToolInvocations(entries, [
    { id: 't1', assistantMessageId: 'assistant-1', turnUserId: 'user-1' },
    { id: 't2', assistantMessageId: 'assistant-2', turnUserId: 'user-1' },
  ]);

  assert.deepEqual(invocationsByEntryIndex.get(1)?.map((item) => item.id), ['t1']);
  assert.deepEqual(invocationsByEntryIndex.get(2)?.map((item) => item.id), ['t2']);
  assert.deepEqual(unanchored, []);
});

test('interleaveToolInvocations 锚点对不上时回退挂到该轮用户消息之后', () => {
  // 会话重载后中间助手消息被持久化过滤：只剩 user 与最终 assistant
  const entries = [
    messageEntry('user-1', 'user', 0),
    messageEntry('assistant-2', 'assistant', 1),
  ];
  const { invocationsByEntryIndex } = interleaveToolInvocations(entries, [
    { id: 't1', assistantMessageId: 'assistant-1', turnUserId: 'user-1' },
    { id: 't2', assistantMessageId: 'assistant-2', turnUserId: 'user-1' },
  ]);

  // t1 锚点没了，回退按 turnUserId 挂到 user-1 之后（即下标 0）；t2 仍锚定 assistant-2
  assert.deepEqual(invocationsByEntryIndex.get(0)?.map((item) => item.id), ['t1']);
  assert.deepEqual(invocationsByEntryIndex.get(1)?.map((item) => item.id), ['t2']);
});

test('interleaveToolInvocations 连 turnUserId 也对不上时挂到最后一条用户消息', () => {
  // 乐观插入的用户消息没有 id：卡片完全对不上锚点
  const entries = [
    messageEntry('user-old', 'user', 0),
    messageEntry(undefined, 'user', 1),
    messageEntry(undefined, 'assistant', 2),
  ];
  const { invocationsByEntryIndex, unanchored } = interleaveToolInvocations(entries, [
    { id: 't1', turnUserId: 'user-gone' },
  ]);

  // user-gone 不在列表里，回退到最后一条用户消息（乐观那条，下标 1）
  assert.deepEqual(invocationsByEntryIndex.get(1)?.map((item) => item.id), ['t1']);
  assert.deepEqual(unanchored, []);
});

test('interleaveToolInvocations 列表里没有用户消息时返回兜底卡片', () => {
  const entries = [messageEntry('assistant-1', 'assistant', 0)];
  const { invocationsByEntryIndex, unanchored } = interleaveToolInvocations(entries, [
    { id: 't1', turnUserId: 'user-gone' },
  ]);

  assert.equal(invocationsByEntryIndex.size, 0);
  assert.deepEqual(unanchored.map((item) => item.id), ['t1']);
});

test('interleaveToolInvocations 同一锚点多张卡片按顺序连续展示', () => {
  const entries = [
    messageEntry('user-1', 'user', 0),
    messageEntry('assistant-1', 'assistant', 1),
  ];
  const { invocationsByEntryIndex } = interleaveToolInvocations(entries, [
    { id: 't1', assistantMessageId: 'assistant-1' },
    { id: 't2', assistantMessageId: 'assistant-1' },
    { id: 't3', assistantMessageId: 'assistant-1' },
  ]);

  assert.deepEqual(invocationsByEntryIndex.get(1)?.map((item) => item.id), ['t1', 't2', 't3']);
});

test('computeTurnLastEntryKey 把每轮停在该轮最后一个条目（助手回复之后）', () => {
  // user-1 → 助手回复；user-2 → 工具消息 + 助手回复
  const lastKey = computeTurnLastEntryKey([
    { key: 'k-user-1', userMessageId: 'user-1' },
    { key: 'k-assistant-1' },
    { key: 'k-user-2', userMessageId: 'user-2' },
    { key: 'k-tool-1' },
    { key: 'k-assistant-2' },
  ]);

  // 预览应挂在助手回复之后，而不是用户消息之后
  assert.equal(lastKey.get('user-1'), 'k-assistant-1');
  assert.equal(lastKey.get('user-2'), 'k-assistant-2');
});

test('computeTurnLastEntryKey 单条用户消息（回复尚未到达）停在用户消息本身', () => {
  const lastKey = computeTurnLastEntryKey([
    { key: 'k-user-1', userMessageId: 'user-1' },
  ]);

  assert.equal(lastKey.get('user-1'), 'k-user-1');
});

test('computeTurnLastEntryKey 乐观用户消息（无 id）终结上一轮归属', () => {
  // 表单轮已落盘（user-1 有 id）；用户提交后再发"再出两道"，这条乐观消息无 id。
  // 上一轮的最后条目必须停在新消息之前，否则上一轮的表单卡片会被拖到本轮推理/回复之后
  const lastKey = computeTurnLastEntryKey([
    { key: 'k-user-1', userMessageId: 'user-1' },
    { key: 'k-assistant-1' },
    { key: 'k-user-opt', isUserMessage: true },
    { key: 'k-assistant-2' },
  ]);

  assert.equal(lastKey.get('user-1'), 'k-assistant-1');
  assert.equal(lastKey.size, 1);
});

test('computeTurnLastEntryKey 无 id 用户消息之间的条目不归属任何轮', () => {
  const lastKey = computeTurnLastEntryKey([
    { key: 'k-user-opt', isUserMessage: true },
    { key: 'k-assistant-1' },
  ]);

  assert.equal(lastKey.size, 0);
});

test('computeTurnLastEntryKey 忽略首条用户消息之前的条目', () => {
  // 分页/摘要可能让列表以非用户消息开头，这些条目不归属任何轮
  const lastKey = computeTurnLastEntryKey([
    { key: 'k-orphan' },
    { key: 'k-user-1', userMessageId: 'user-1' },
    { key: 'k-assistant-1' },
  ]);

  assert.equal(lastKey.has('user-1'), true);
  assert.equal(lastKey.get('user-1'), 'k-assistant-1');
  assert.equal(lastKey.size, 1);
});
