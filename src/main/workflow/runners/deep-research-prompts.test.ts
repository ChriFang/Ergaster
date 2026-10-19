import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeepResearchDepth } from '../../../shared/workflow';
import {
  createDefaultDeepResearchConfig,
  maxSubtaskCount,
  parseResearchSubtasks,
  shouldRunAnotherResearchRound,
} from './deep-research-prompts';

function configOf(depth: DeepResearchDepth) {
  return createDefaultDeepResearchConfig({ topic: '测试议题', depth });
}

test('maxSubtaskCount 按研究深度限制并行子任务数量', () => {
  assert.equal(maxSubtaskCount(configOf('quick')), 2);
  assert.equal(maxSubtaskCount(configOf('standard')), 4);
  assert.equal(maxSubtaskCount(configOf('deep')), 6);
});

test('parseResearchSubtasks 只解析【子任务清单】里的三段式行', () => {
  const plan = [
    '【子问题】',
    '- SQ0 | 这行在子任务清单之前 | 不应被解析',
    '',
    '【子任务清单】',
    'SQ1 | 市场规模 | 查找 2024 年该市场的公开规模数据并给出来源',
    '- SQ2 | 主要玩家 | 列出头部厂商及其份额',
    '这行格式不对，应被跳过',
    'X3 | 编号不合法 | 应被跳过',
    'SQ4 | 缺指令 | ',
  ].join('\n');

  assert.deepEqual(parseResearchSubtasks(plan, 6), [
    { id: 'SQ1', title: '市场规模', instruction: '查找 2024 年该市场的公开规模数据并给出来源' },
    { id: 'SQ2', title: '主要玩家', instruction: '列出头部厂商及其份额' },
  ]);
});

test('parseResearchSubtasks 去重并遵守数量上限', () => {
  const plan = [
    '【子任务清单】',
    'SQ1 | A | 指令 A',
    'sq1 | A 重复 | 指令 A 重复',
    'SQ2 | B | 指令 B',
    'SQ3 | C | 指令 C',
  ].join('\n');

  const subtasks = parseResearchSubtasks(plan, 2);
  assert.deepEqual(subtasks.map((subtask) => subtask.id), ['SQ1', 'SQ2']);
});

test('parseResearchSubtasks 无可解析内容时返回空数组，便于回退旧路径', () => {
  assert.deepEqual(parseResearchSubtasks('【子任务清单】\n无', 4), []);
  assert.deepEqual(parseResearchSubtasks('完全自由的文本', 4), []);
});

test('parseResearchSubtasks 保留指令中的竖线', () => {
  const plan = '【子任务清单】\nSQ1 | 标题 | 先查 A | 再查 B';
  assert.deepEqual(parseResearchSubtasks(plan, 4), [
    { id: 'SQ1', title: '标题', instruction: '先查 A | 再查 B' },
  ]);
});

test('shouldRunAnotherResearchRound 只在明确建议追加时返回 true', () => {
  const gapOf = (answer: string) => `【是否足够】\n部分足够\n\n【是否建议追加一轮】\n${answer}\n\n【原因】\n...`;

  assert.equal(shouldRunAnotherResearchRound(gapOf('是')), true);
  assert.equal(shouldRunAnotherResearchRound(gapOf('是，需要补充监管口径')), true);
  assert.equal(shouldRunAnotherResearchRound(gapOf('否')), false);
  assert.equal(shouldRunAnotherResearchRound(gapOf('')), false);
  assert.equal(shouldRunAnotherResearchRound('没有这个小节'), false);
});
