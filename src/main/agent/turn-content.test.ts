import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatCompletionApiMessage, ChatContentPart } from './deepseek-client';
import { injectTurnUserContent } from './turn-content';

const multimodal: ChatContentPart[] = [
  { type: 'text', text: '分析这张图' },
  { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
];

function baseHistory(): ChatCompletionApiMessage[] {
  return [
    { id: 'u-prev', role: 'user', content: '你好' },
    { id: 'a-prev', role: 'assistant', content: '你好，有什么可以帮你' },
    { id: 'u-turn', role: 'user', content: '分析这张图' },
  ];
}

test('injectTurnUserContent 只替换本轮用户消息，历史消息不动', () => {
  const result = injectTurnUserContent(baseHistory(), 'u-turn', multimodal);
  assert.equal(result[0].content, '你好');
  assert.equal(result[2].content, multimodal);
});

test('injectTurnUserContent 工具轮次后末尾是 tool 消息仍能命中本轮 user', () => {
  // 复现多轮：本轮 user 之后追加了 assistant(tool_calls) 与 tool 结果，末尾不再是 user
  const messages: ChatCompletionApiMessage[] = [
    ...baseHistory(),
    { id: 'a-1', role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'create_text_draft', arguments: '{}' } }] },
    { id: null as unknown as string, role: 'tool', tool_call_id: 't1', content: '{"ok":true}' },
  ];
  const result = injectTurnUserContent(messages, 'u-turn', multimodal);
  const turnMessage = result.find((message) => message.id === 'u-turn');
  assert.equal(turnMessage?.content, multimodal);
  // tool 消息保持不变
  assert.equal(result[result.length - 1].content, '{"ok":true}');
});

test('injectTurnUserContent turnUserId 为空时原样返回', () => {
  const history = baseHistory();
  assert.equal(injectTurnUserContent(history, undefined, multimodal), history);
});

test('injectTurnUserContent 不修改原数组', () => {
  const history = baseHistory();
  injectTurnUserContent(history, 'u-turn', multimodal);
  assert.equal(history[2].content, '分析这张图');
});
