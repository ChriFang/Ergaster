import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemoryEntry } from '../../shared/memory';
import {
  buildMemoryBlock,
  classifyTurn,
  isNearDuplicate,
  parseExtractedMemories,
  rankEntriesForPrompt,
  similarity,
} from './memory-text-utils';

function entry(partial: Partial<MemoryEntry> & { content: string }): MemoryEntry {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    kind: partial.kind ?? 'fact',
    content: partial.content,
    pinned: partial.pinned ?? false,
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-01-01T00:00:00.000Z',
    lastUsedAt: partial.lastUsedAt ?? null,
    useCount: partial.useCount ?? 0,
    sourceConversationId: partial.sourceConversationId ?? null,
  };
}

test('similarity 相同为 1、无交集为 0、部分重合居中', () => {
  assert.equal(similarity('用户喜欢 TypeScript', '用户喜欢 TypeScript'), 1);
  assert.equal(similarity('abcd', 'wxyz'), 0);
  const partial = similarity('用户喜欢 TypeScript', '用户喜欢 Rust');
  assert.ok(partial > 0 && partial < 1);
});

test('isNearDuplicate 命中近重复内容', () => {
  const existing = [entry({ content: '用户只用 TypeScript，不写注释' })];
  assert.equal(isNearDuplicate('用户只用 TypeScript，不写注释', existing), true);
  assert.equal(isNearDuplicate('用户住在北京', existing), false);
});

test('rankEntriesForPrompt 置顶优先，其次相似度，并遵守 limit', () => {
  const entries = [
    entry({ id: 'a', content: '用户在做记忆功能项目' }),
    entry({ id: 'b', content: '用户喜欢喝美式咖啡', pinned: true }),
    entry({ id: 'c', content: '天气与本次无关的内容' }),
  ];
  const ranked = rankEntriesForPrompt(entries, '记忆功能', 2);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, 'b'); // pinned 永远排前
  assert.equal(ranked[1].id, 'a'); // 其次是与 query 最相似的
});

test('buildMemoryBlock 空数组返回空串，非空带表头', () => {
  assert.equal(buildMemoryBlock([]), '');
  const block = buildMemoryBlock([entry({ content: '用户偏好简洁回复', kind: 'preference' })]);
  assert.match(block, /长期记忆/);
  assert.match(block, /\(preference\) 用户偏好简洁回复/);
});

test('buildMemoryBlock 受字符预算约束截断', () => {
  const entries = Array.from({ length: 20 }, (_, i) => entry({ content: `事实${i}`.padEnd(40, '啊') }));
  const block = buildMemoryBlock(entries, 120);
  // 预算很小，行数应远少于 20
  assert.ok(block.split('\n').length < 12);
});

test('parseExtractedMemories 解析合法数组、非法 kind 归为 fact', () => {
  const parsed = parseExtractedMemories('[{"kind":"profile","content":"用户是数据科学家"},{"content":"用户偏好 Rust"}]');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].kind, 'profile');
  assert.equal(parsed[1].kind, 'fact'); // 缺省/非法 kind 归 fact
});

test('parseExtractedMemories 容错：夹带文本、空数组、非数组、坏 JSON', () => {
  assert.deepEqual(parseExtractedMemories('这是解释\n[]\n完毕'), []);
  assert.deepEqual(parseExtractedMemories('没有数组'), []);
  assert.deepEqual(parseExtractedMemories('{"content":"x"}'), []);
  assert.deepEqual(parseExtractedMemories('[坏 json'), []);
  const ok = parseExtractedMemories('前言 [{"content":"用户住在上海"}] 后记');
  assert.equal(ok.length, 1);
  assert.equal(ok[0].content, '用户住在上海');
});

test('classifyTurn 三档判定', () => {
  assert.equal(classifyTurn('谢谢'), 'skip');
  assert.equal(classifyTurn('ok'), 'skip');
  assert.equal(classifyTurn('嗯'), 'skip');
  assert.equal(classifyTurn('我是一名后端工程师'), 'now');
  assert.equal(classifyTurn('以后回复都简短一点'), 'now');
  assert.equal(classifyTurn('记住我用的是 macOS'), 'now');
  assert.equal(classifyTurn('把这个函数改成异步的并加上错误处理'), 'sweep');
});
