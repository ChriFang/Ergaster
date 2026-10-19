import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySlashSelection,
  buildSkillInjection,
  extractSlashSkillNames,
  filterSlashCandidates,
  getSlashTriggerState,
  groupSlashCandidates,
} from './slash-command';

const CANDIDATES = [
  { name: 'daban3', description: '智能龙虎榜分析系统' },
  { name: 'get-crash-stack', description: '从崩溃文件中提取堆栈' },
  { name: 'daily-report', description: '生成每日汇报，含 crash 统计' },
];

test('getSlashTriggerState 在行首触发', () => {
  assert.deepEqual(getSlashTriggerState('/', 1), { startIndex: 0, query: '' });
  assert.deepEqual(getSlashTriggerState('/dab', 4), { startIndex: 0, query: 'dab' });
});

test('getSlashTriggerState 在空白或换行之后触发', () => {
  assert.deepEqual(getSlashTriggerState('帮我 /dab', 7), { startIndex: 3, query: 'dab' });
  assert.deepEqual(getSlashTriggerState('第一行\n/dab', 8), { startIndex: 4, query: 'dab' });
});

test('getSlashTriggerState 不会被 URL 与文件路径误触发', () => {
  assert.equal(getSlashTriggerState('https://example.com', 19), null);
  assert.equal(getSlashTriggerState('src/main/index.ts', 17), null);
  assert.equal(getSlashTriggerState('a/b', 3), null);
});

test('getSlashTriggerState 光标离开候选词后失效', () => {
  // "/dab 帮" —— 光标在空格之后，已经不在候选词内
  assert.equal(getSlashTriggerState('/dab 帮', 6), null);
});

test('getSlashTriggerState 对越界与无 / 的输入返回 null', () => {
  assert.equal(getSlashTriggerState('', 0), null);
  assert.equal(getSlashTriggerState('abc', 3), null);
  assert.equal(getSlashTriggerState('/abc', 99), null);
});

test('filterSlashCandidates 空查询返回全部并保持原顺序', () => {
  assert.deepEqual(filterSlashCandidates(CANDIDATES, '').map((item) => item.name), ['daban3', 'get-crash-stack', 'daily-report']);
  assert.deepEqual(filterSlashCandidates(CANDIDATES, '   ').map((item) => item.name), ['daban3', 'get-crash-stack', 'daily-report']);
});

test('filterSlashCandidates 按前缀 > 名称包含 > 描述包含排序', () => {
  // "crash" 只在 get-crash-stack 的名称中间命中，在 daily-report 的描述里命中
  assert.deepEqual(
    filterSlashCandidates(CANDIDATES, 'crash').map((item) => item.name),
    ['get-crash-stack', 'daily-report'],
  );

  // "da" 是 daban3 与 daily-report 的名称前缀，同档保持原顺序
  assert.deepEqual(
    filterSlashCandidates(CANDIDATES, 'da').map((item) => item.name),
    ['daban3', 'daily-report'],
  );
});

test('filterSlashCandidates 大小写无关且无命中时返回空', () => {
  assert.deepEqual(filterSlashCandidates(CANDIDATES, 'DABAN').map((item) => item.name), ['daban3']);
  assert.deepEqual(filterSlashCandidates(CANDIDATES, 'zzz'), []);
});

test('applySlashSelection 替换候选词并把光标移到标记之后', () => {
  const trigger = getSlashTriggerState('帮我 /dab', 7);
  assert.ok(trigger);

  const result = applySlashSelection('帮我 /dab', trigger, 'daban3');
  assert.equal(result.text, '帮我 /daban3 ');
  assert.equal(result.caret, result.text.length);
});

test('applySlashSelection 后面已有空白时不补空格', () => {
  const text = '/dab 分析一下';
  const trigger = getSlashTriggerState(text, 4);
  assert.ok(trigger);

  const result = applySlashSelection(text, trigger, 'daban3');
  assert.equal(result.text, '/daban3 分析一下');
  assert.equal(result.caret, '/daban3'.length);
});

test('extractSlashSkillNames 按出现顺序去重且只认已知名称', () => {
  const known = ['daban3', 'get-crash-stack'];

  assert.deepEqual(extractSlashSkillNames('/get-crash-stack /daban3 帮我看看', known), ['get-crash-stack', 'daban3']);
  assert.deepEqual(extractSlashSkillNames('/daban3 /daban3', known), ['daban3']);
  assert.deepEqual(extractSlashSkillNames('/unknown-skill 帮我看看', known), []);
});

test('extractSlashSkillNames 忽略 URL 与路径中的斜杠', () => {
  const known = ['daban3', 'main'];

  assert.deepEqual(extractSlashSkillNames('看下 https://x.com/daban3', known), []);
  assert.deepEqual(extractSlashSkillNames('读取 src/main/index.ts', known), []);
});

test('extractSlashSkillNames 没有已知名称时直接返回空', () => {
  assert.deepEqual(extractSlashSkillNames('/daban3', []), []);
});

test('buildSkillInjection 带上根目录说明与正文', () => {
  const injection = buildSkillInjection([
    { name: 'daban3', directoryPath: '/home/u/.ergaster/skills/longhubang-1.0.0', content: '  # 打板3\n步骤…  ' },
  ]);

  assert.ok(injection.includes('用户通过 / 指令显式指定了以下 Skill'));
  assert.ok(injection.includes('## Skill: daban3'));
  assert.ok(injection.includes('[Skill 根目录]: /home/u/.ergaster/skills/longhubang-1.0.0'));
  assert.ok(injection.includes('相对于上述根目录'));
  assert.ok(injection.includes('# 打板3\n步骤…'));
});

test('buildSkillInjection 多个 skill 按传入顺序拼接', () => {
  const injection = buildSkillInjection([
    { name: 'a', directoryPath: '/p/a', content: 'AAA' },
    { name: 'b', directoryPath: '/p/b', content: 'BBB' },
  ]);

  assert.ok(injection.indexOf('## Skill: a') < injection.indexOf('## Skill: b'));
});

test('buildSkillInjection 空列表返回空串', () => {
  assert.equal(buildSkillInjection([]), '');
});

const GROUP_CANDIDATES = [
  { name: 'ui', description: '要求模型输出JSON UI DSL, 使用表单收集参数', kind: 'command' as const },
  { name: 'daban3', description: '龙虎榜分析' },
  { name: 'daily-report', description: '每日汇报' },
];

test('groupSlashCandidates 按 命令/Skills 分组且顺序固定', () => {
  const groups = groupSlashCandidates(GROUP_CANDIDATES, []);
  assert.deepEqual(groups.map((group) => group.key), ['command', 'skill']);
  assert.deepEqual(groups[0].items.map((item) => item.name), ['ui']);
  assert.deepEqual(groups[1].items.map((item) => item.name), ['daban3', 'daily-report']);
});

test('groupSlashCandidates 最近使用提到顶部且仍保留在原分区', () => {
  const groups = groupSlashCandidates(GROUP_CANDIDATES, ['daily-report', 'ui']);
  assert.deepEqual(groups.map((group) => group.key), ['recent', 'command', 'skill']);
  // recent 按 recentNames 顺序
  assert.deepEqual(groups[0].items.map((item) => item.name), ['daily-report', 'ui']);
  // ui 仍出现在命令分区
  assert.deepEqual(groups[1].items.map((item) => item.name), ['ui']);
  // daily-report 仍出现在 Skills 分区（同时也在最近使用里）
  assert.deepEqual(groups[2].items.map((item) => item.name), ['daban3', 'daily-report']);
});

test('groupSlashCandidates 忽略不在候选中的最近项', () => {
  const groups = groupSlashCandidates(GROUP_CANDIDATES, ['gone']);
  assert.deepEqual(groups.map((group) => group.key), ['command', 'skill']);
});

test('groupSlashCandidates 空候选返回空数组', () => {
  assert.deepEqual(groupSlashCandidates([], ['ui']), []);
});
