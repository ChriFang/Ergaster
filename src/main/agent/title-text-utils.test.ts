import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONVERSATION_TITLE, buildFallbackTitle, buildTitleRequestContent, sanitizeGeneratedTitle } from './title-text-utils';

test('buildTitleRequestContent 拼接用户输入与助手回复', () => {
  const content = buildTitleRequestContent('怎么配置 MCP 服务器？', '在设置里添加即可。');
  assert.match(content, /用户输入：怎么配置 MCP 服务器？/);
  assert.match(content, /助手回复：在设置里添加即可。/);
});

test('buildTitleRequestContent 归一化空白并截断超长内容', () => {
  const longText = `${'a'.repeat(600)}`;
  const content = buildTitleRequestContent(`  多  行\n输入\t内容  ${longText}`, `回复${'b'.repeat(600)}`);
  assert.doesNotMatch(content, /\n\s+/);
  const promptLine = content.split('\n')[0];
  const replyLine = content.split('\n')[1];
  assert.ok(promptLine.length <= '用户输入：'.length + 500);
  assert.ok(replyLine.length <= '助手回复：'.length + 500);
});

test('buildTitleRequestContent 空内容使用占位文案', () => {
  const content = buildTitleRequestContent('', '');
  assert.match(content, /用户输入：（无文本内容）/);
  assert.match(content, /助手回复：（无文本内容）/);
});

test('sanitizeGeneratedTitle 去掉引号与常见前后缀', () => {
  assert.equal(sanitizeGeneratedTitle('“如何配置 MCP 服务器”', '回退'), '如何配置 MCP 服务器');
  assert.equal(sanitizeGeneratedTitle('标题：部署问题排查', '回退'), '部署问题排查');
  assert.equal(sanitizeGeneratedTitle('主题: 前端构建报错！', '回退'), '前端构建报错');
});

test('sanitizeGeneratedTitle 超长截断到 30 字', () => {
  const longTitle = '这是一个非常长的标题'.repeat(10);
  assert.equal(sanitizeGeneratedTitle(longTitle, '回退').length, 30);
});

test('sanitizeGeneratedTitle 无效输出回退到首句截断', () => {
  assert.equal(sanitizeGeneratedTitle('   ', '数据库连接失败'), '数据库连接失败');
  assert.equal(sanitizeGeneratedTitle('。。。', '数据库连接失败'), '数据库连接失败');
});

test('sanitizeGeneratedTitle 回退也为空时使用默认标题', () => {
  assert.equal(sanitizeGeneratedTitle('', ''), DEFAULT_CONVERSATION_TITLE);
  assert.equal(sanitizeGeneratedTitle('???', '   '), DEFAULT_CONVERSATION_TITLE);
});

test('buildFallbackTitle 截断首句，空输入回退默认标题', () => {
  assert.equal(buildFallbackTitle(`${'x'.repeat(120)}`).length, 80);
  assert.equal(buildFallbackTitle('帮我看下日志'), '帮我看下日志');
  assert.equal(buildFallbackTitle(''), DEFAULT_CONVERSATION_TITLE);
});
