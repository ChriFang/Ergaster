import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentStreamEvent } from '../../../shared/agent';
import {
  MAX_SESSION_BUCKETS,
  appendFilePreviewToSession,
  appendUiWidgetToSession,
  bufferStreamEvent,
  createEmptySession,
  createEmptyStore,
  ensureSession,
  flushSession,
  getSession,
  hasAnyRunning,
  markUiWidgetPoppedOut,
  markUiWidgetSubmitted,
  pruneTransientCardsToTurns,
  removeSession,
  updateSession,
  upsertToolInvocationToSession,
} from './session-store';

function delta(conversationId: string, streamMessageId: string, text: string): AgentStreamEvent {
  return { conversationId, streamMessageId, deltaContent: text };
}

test('ensureSession 建桶并标记最近使用', () => {
  let store = createEmptyStore();
  store = ensureSession(store, 'a');
  store = ensureSession(store, 'b');
  assert.deepEqual(store.order, ['a', 'b']);
  store = ensureSession(store, 'a');
  assert.deepEqual(store.order, ['b', 'a']); // a 变最近
});

test('getSession 未命中返回 null', () => {
  const store = ensureSession(createEmptyStore(), 'a');
  assert.notEqual(getSession(store, 'a'), null);
  assert.equal(getSession(store, 'missing'), null);
  assert.equal(getSession(store, null), null);
});

test('updateSession 浅合并且不改动其它桶', () => {
  let store = ensureSession(createEmptyStore(), 'a');
  store = ensureSession(store, 'b');
  store = updateSession(store, 'a', { isRunning: true, runStatus: '执行中' });
  assert.equal(getSession(store, 'a')?.isRunning, true);
  assert.equal(getSession(store, 'a')?.runStatus, '执行中');
  assert.equal(getSession(store, 'b')?.isRunning, false);
});

test('bufferStreamEvent 累积到对应桶，flushSession 合并进 messages 并清空缓冲', () => {
  let store = ensureSession(createEmptyStore(), 'a');
  store = bufferStreamEvent(store, 'a', delta('a', 'm1', '你'));
  store = bufferStreamEvent(store, 'a', delta('a', 'm1', '好'));
  assert.equal(getSession(store, 'a')?.pendingStreamEvents.length, 2);
  assert.equal(getSession(store, 'a')?.messages.length, 0);

  store = flushSession(store, 'a');
  assert.equal(getSession(store, 'a')?.pendingStreamEvents.length, 0);
  assert.equal(getSession(store, 'a')?.messages.length, 1);
  assert.equal(getSession(store, 'a')?.messages[0]?.content, '你好');
});

test('多会话流缓冲互不串桶', () => {
  let store = ensureSession(createEmptyStore(), 'a');
  store = ensureSession(store, 'b');
  store = bufferStreamEvent(store, 'a', delta('a', 'ma', 'A内容'));
  store = bufferStreamEvent(store, 'b', delta('b', 'mb', 'B内容'));
  store = flushSession(store, 'a');
  store = flushSession(store, 'b');
  assert.equal(getSession(store, 'a')?.messages[0]?.content, 'A内容');
  assert.equal(getSession(store, 'b')?.messages[0]?.content, 'B内容');
});

test('flushSession 缓冲为空时原样返回', () => {
  const store = ensureSession(createEmptyStore(), 'a');
  assert.equal(flushSession(store, 'a'), store);
});

test('appendFilePreviewToSession 同 key 替换而非追加', () => {
  let store = ensureSession(createEmptyStore(), 'a');
  store = appendFilePreviewToSession(store, 'a', { kind: 'image', fileName: 'x.png', path: '/tmp/x.png', turnUserId: 'u1' });
  store = appendFilePreviewToSession(store, 'a', { kind: 'image', fileName: 'x.png', path: '/tmp/x.png', turnUserId: 'u1' });
  assert.equal(getSession(store, 'a')?.filePreviews.length, 1);
  store = appendFilePreviewToSession(store, 'a', { kind: 'image', fileName: 'y.png', path: '/tmp/y.png', turnUserId: 'u1' });
  assert.equal(getSession(store, 'a')?.filePreviews.length, 2);
});

test('removeSession 删桶并清 order', () => {
  let store = ensureSession(createEmptyStore(), 'a');
  store = ensureSession(store, 'b');
  store = removeSession(store, 'a');
  assert.equal(getSession(store, 'a'), null);
  assert.deepEqual(store.order, ['b']);
});

test('hasAnyRunning 任一桶运行中即为真', () => {
  let store = ensureSession(createEmptyStore(), 'a');
  store = ensureSession(store, 'b');
  assert.equal(hasAnyRunning(store), false);
  store = updateSession(store, 'b', { isRunning: true });
  assert.equal(hasAnyRunning(store), true);
});

test('LRU 超限淘汰最久未用的非运行桶', () => {
  let store = createEmptyStore();
  for (let i = 0; i < MAX_SESSION_BUCKETS; i += 1) {
    store = ensureSession(store, `s${i}`);
  }
  // 再进一个，触发淘汰：最久未用是 s0
  store = ensureSession(store, 'sNew');
  assert.equal(getSession(store, 's0'), null);
  assert.equal(getSession(store, 'sNew') !== null, true);
  assert.equal(store.order.length, MAX_SESSION_BUCKETS);
});

test('LRU 运行中的桶永不淘汰', () => {
  let store = createEmptyStore();
  store = ensureSession(store, 'running');
  store = updateSession(store, 'running', { isRunning: true });
  // 填满其它非运行桶并继续新增，running 始终不被淘汰
  for (let i = 0; i < MAX_SESSION_BUCKETS + 2; i += 1) {
    store = ensureSession(store, `s${i}`);
  }
  assert.equal(getSession(store, 'running') !== null, true);
});

function htmlWidget(widgetId: string) {
  return {
    kind: 'html' as const,
    widgetId,
    spec: { version: 1 as const, widgetId, title: 't', html: '<p>x</p>' },
  };
}

test('appendUiWidgetToSession 初始 submitted/poppedOut 均为 false，重复 widgetId 忽略', () => {
  let store = createEmptyStore();
  store = appendUiWidgetToSession(store, 'c', htmlWidget('w1'));
  store = appendUiWidgetToSession(store, 'c', htmlWidget('w1')); // 同 id 忽略
  const widgets = getSession(store, 'c')?.uiWidgets ?? [];
  assert.equal(widgets.length, 1);
  assert.equal(widgets[0].submitted, false);
  assert.equal(widgets[0].poppedOut, false);
});

test('markUiWidgetPoppedOut 只改目标 widget 的 poppedOut，可来回切换', () => {
  let store = createEmptyStore();
  store = appendUiWidgetToSession(store, 'c', htmlWidget('w1'));
  store = appendUiWidgetToSession(store, 'c', htmlWidget('w2'));
  store = markUiWidgetPoppedOut(store, 'c', 'w1', true);
  let widgets = getSession(store, 'c')?.uiWidgets ?? [];
  assert.equal(widgets.find((w) => w.widgetId === 'w1')?.poppedOut, true);
  assert.equal(widgets.find((w) => w.widgetId === 'w2')?.poppedOut, false);
  // 关闭窗口后恢复
  store = markUiWidgetPoppedOut(store, 'c', 'w1', false);
  widgets = getSession(store, 'c')?.uiWidgets ?? [];
  assert.equal(widgets.find((w) => w.widgetId === 'w1')?.poppedOut, false);
});

test('markUiWidgetSubmitted 锁定不影响 poppedOut', () => {
  let store = createEmptyStore();
  store = appendUiWidgetToSession(store, 'c', htmlWidget('w1'));
  store = markUiWidgetPoppedOut(store, 'c', 'w1', true);
  store = markUiWidgetSubmitted(store, 'c', 'w1');
  const widget = getSession(store, 'c')?.uiWidgets.find((w) => w.widgetId === 'w1');
  assert.equal(widget?.submitted, true);
  assert.equal(widget?.poppedOut, true);
});

test('新桶默认 lastStreamAt 为 0，可被 updateSession 刷新', () => {
  assert.equal(createEmptySession().lastStreamAt, 0);
  let store = createEmptyStore();
  store = ensureSession(store, 'c');
  store = updateSession(store, 'c', { lastStreamAt: 123456 });
  assert.equal(getSession(store, 'c')?.lastStreamAt, 123456);
  store = updateSession(store, 'c', { lastStreamAt: 0 });
  assert.equal(getSession(store, 'c')?.lastStreamAt, 0);
});

test('新桶默认 toolInvocations 为空数组', () => {
  assert.deepEqual(createEmptySession().toolInvocations, []);
});

test('upsertToolInvocationToSession 先 append running，再按同 toolCallId 原地更新为 success', () => {
  let store = createEmptyStore();
  store = upsertToolInvocationToSession(store, 'c', {
    turnUserId: 'u1',
    toolCallId: 'call_1',
    name: 'http_request',
    argsSummary: '{"url":"https://x"}',
    status: 'running',
  });
  let invocations = getSession(store, 'c')?.toolInvocations ?? [];
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].status, 'running');
  assert.equal(invocations[0].id, 'call_1');

  store = upsertToolInvocationToSession(store, 'c', {
    turnUserId: 'u1',
    toolCallId: 'call_1',
    name: 'http_request',
    status: 'success',
    ok: true,
    resultContent: '{"ok":true,"content":"done"}',
  });
  invocations = getSession(store, 'c')?.toolInvocations ?? [];
  // 长度不变、原地更新为终态，且保留 running 时的 argsSummary（终态未重发）
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].status, 'success');
  assert.equal(invocations[0].ok, true);
  assert.equal(invocations[0].resultContent, '{"ok":true,"content":"done"}');
  assert.equal(invocations[0].argsSummary, '{"url":"https://x"}');
});

test('upsertToolInvocationToSession 不同 toolCallId 追加为多条', () => {
  let store = createEmptyStore();
  store = upsertToolInvocationToSession(store, 'c', { toolCallId: 'call_1', name: 'a', status: 'running' });
  store = upsertToolInvocationToSession(store, 'c', { toolCallId: 'call_2', name: 'b', status: 'running' });
  const invocations = getSession(store, 'c')?.toolInvocations ?? [];
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations.map((item) => item.toolCallId), ['call_1', 'call_2']);
});

test('pruneTransientCardsToTurns 撤销后只保留幸存轮次的瞬时卡片', () => {
  let store = createEmptyStore();
  // u1、u2 两轮各产生工具调用；u1 有文件预览，u2 有交互组件
  store = upsertToolInvocationToSession(store, 'c', { turnUserId: 'u1', toolCallId: 'call_1', name: 'a', status: 'success' });
  store = upsertToolInvocationToSession(store, 'c', { turnUserId: 'u2', toolCallId: 'call_2', name: 'b', status: 'success' });
  store = appendFilePreviewToSession(store, 'c', { kind: 'image', fileName: 'x.png', path: '/tmp/x.png', turnUserId: 'u1' });
  store = appendUiWidgetToSession(store, 'c', { kind: 'html', widgetId: 'w2', turnUserId: 'u2', spec: { version: 1, widgetId: 'w2', title: 't', html: '<p>x</p>' } });

  // 撤销 u2 那一轮：只有 u1 幸存
  store = pruneTransientCardsToTurns(store, 'c', new Set(['u1']));
  const session = getSession(store, 'c');
  assert.deepEqual(session?.toolInvocations.map((item) => item.toolCallId), ['call_1']);
  assert.equal(session?.filePreviews.length, 1);
  assert.equal(session?.uiWidgets.length, 0);
});

test('pruneTransientCardsToTurns 幸存集合为空时清空全部，且丢弃无 turnUserId 的卡片', () => {
  let store = createEmptyStore();
  store = upsertToolInvocationToSession(store, 'c', { turnUserId: 'u1', toolCallId: 'call_1', name: 'a', status: 'success' });
  // 缺 turnUserId 的异常卡片：撤销时无法归属轮次，一并清除
  store = upsertToolInvocationToSession(store, 'c', { toolCallId: 'call_x', name: 'x', status: 'success' });

  store = pruneTransientCardsToTurns(store, 'c', new Set());
  assert.deepEqual(getSession(store, 'c')?.toolInvocations, []);
});
