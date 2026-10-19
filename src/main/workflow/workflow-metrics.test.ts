import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowRunMetrics } from '../../shared/workflow';
import { WorkflowMetricsCollector } from './workflow-metrics';

function collect() {
  const collector = new WorkflowMetricsCollector();
  const events: Array<{ runId: string; metrics: WorkflowRunMetrics }> = [];
  collector.onChange((runId, metrics) => events.push({ runId, metrics }));
  return { collector, events };
}

test('start 初始化计数并通知一次', () => {
  const { collector, events } = collect();
  collector.start('run-1', 1000);

  assert.equal(events.length, 1);
  assert.deepEqual(collector.get('run-1'), {
    startedAt: 1000,
    finishedAt: undefined,
    modelRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });
});

test('addRequest 累加请求次数与输入 token', () => {
  const { collector } = collect();
  collector.start('run-1', 1000);

  collector.addRequest('run-1', [{ role: 'user', content: '你好' }]);
  collector.addRequest('run-1', [{ role: 'user', content: '你好' }]);

  const metrics = collector.get('run-1');
  assert.equal(metrics?.modelRequests, 2);
  assert.ok((metrics?.promptTokens ?? 0) > 0);
  assert.equal(metrics?.completionTokens, 0);
});

test('addCompletionText 逐段累加时不会因取整放大误差', () => {
  const { collector } = collect();
  const chunked = new WorkflowMetricsCollector();

  collector.start('whole', 0);
  chunked.start('chunked', 0);

  const text = 'abcdefghij'.repeat(20);
  collector.addCompletionText('whole', text);
  for (const char of text) {
    chunked.addCompletionText('chunked', char);
  }

  // 200 个 ASCII 字符按 0.25 权重应约 50 token；逐字符取整会变成 200
  assert.equal(collector.get('whole')?.completionTokens, 50);
  assert.equal(chunked.get('chunked')?.completionTokens, 50);
});

test('addCompletionText 同时统计正文与 reasoning，忽略空值', () => {
  const { collector, events } = collect();
  collector.start('run-1', 0);
  const before = events.length;

  collector.addCompletionText('run-1', undefined, undefined);
  assert.equal(events.length, before, '没有新增内容时不应通知');

  collector.addCompletionText('run-1', 'aaaa', 'bbbb');
  assert.equal(collector.get('run-1')?.completionTokens, 2);
});

test('totalTokens 是输入与输出之和', () => {
  const { collector } = collect();
  collector.start('run-1', 0);
  collector.addCompletionText('run-1', 'a'.repeat(40));

  const metrics = collector.get('run-1');
  assert.equal(metrics?.totalTokens, (metrics?.promptTokens ?? 0) + (metrics?.completionTokens ?? 0));
});

test('finish 记录结束时间且幂等', () => {
  const { collector, events } = collect();
  collector.start('run-1', 1000);

  collector.finish('run-1', 5000);
  const afterFirst = events.length;
  collector.finish('run-1', 9000);

  assert.equal(collector.get('run-1')?.finishedAt, 5000, '重复 finish 不应覆盖首次时间');
  assert.equal(events.length, afterFirst, '重复 finish 不应再次通知');
});

test('未 start 的 runId 上的写入被忽略，不会凭空创建记录', () => {
  const { collector, events } = collect();

  collector.addRequest('unknown', [{ role: 'user', content: 'x' }]);
  collector.addCompletionText('unknown', 'x');
  collector.finish('unknown', 1);

  assert.equal(collector.get('unknown'), null);
  assert.equal(events.length, 0);
});

test('多个 run 之间互不干扰', () => {
  const { collector } = collect();
  collector.start('run-1', 0);
  collector.start('run-2', 0);

  collector.addCompletionText('run-1', 'a'.repeat(40));

  assert.equal(collector.get('run-1')?.completionTokens, 10);
  assert.equal(collector.get('run-2')?.completionTokens, 0);
});

test('remove 清掉记录', () => {
  const { collector } = collect();
  collector.start('run-1', 0);
  collector.remove('run-1');

  assert.equal(collector.get('run-1'), null);
});
