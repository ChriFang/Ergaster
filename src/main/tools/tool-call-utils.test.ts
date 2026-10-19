import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatCompletionApiMessage } from '../agent/deepseek-client';
import {
  compactToolMessageContent,
  dropOrphanToolMessages,
  extractBase64ImagesFromText,
  filterValidToolCalls,
  hasToolImageContent,
  maxToolResultImageChars,
  maxToolResultImages,
  moveToolImagesToUserMessage,
  summarizeMessagesForDiagnostics,
  toToolMessage,
  toUpstreamMessages,
} from './tool-call-utils';
import type { ToolResult } from '../../shared/tools';

function toolCall(id: string, name: string, args = '{}') {
  return { id, type: 'function' as const, function: { name, arguments: args } };
}

test('filterValidToolCalls 保留完整的 tool_call 并原样透传参数', () => {
  const result = filterValidToolCalls([
    toolCall('call_1', 'read_file', '{"path":"a.txt"}'),
    toolCall('call_2', 'list_dir', ''),
  ]);

  assert.deepEqual(result.droppedReasons, []);
  assert.deepEqual(result.valid, [
    toolCall('call_1', 'read_file', '{"path":"a.txt"}'),
    toolCall('call_2', 'list_dir', ''),
  ]);
});

test('filterValidToolCalls 丢弃缺 id、缺工具名与重复 id 的调用', () => {
  const result = filterValidToolCalls([
    toolCall('', 'read_file'),
    toolCall('  ', 'read_file'),
    toolCall('call_1', '   '),
    toolCall('call_2', 'read_file'),
    toolCall('call_2', 'read_file'),
  ]);

  assert.deepEqual(result.valid.map((item) => item.id), ['call_2']);
  assert.equal(result.droppedReasons.length, 4);
  assert.match(result.droppedReasons[0], /缺少 tool_call id/);
  assert.match(result.droppedReasons[2], /缺少工具名/);
  assert.match(result.droppedReasons[3], /重复/);
});

test('filterValidToolCalls 丢弃参数不是合法 JSON 的调用，且不回显参数内容', () => {
  const broken = '{"SearchDocumentsReq">\n<｜｜DSML｜｜parameter: "创建HarmonyOS应用"}';
  const result = filterValidToolCalls([toolCall('call_00_71yb', 'mcp_0_1', broken)]);

  assert.deepEqual(result.valid, []);
  assert.equal(result.droppedReasons.length, 1);
  assert.match(result.droppedReasons[0], /参数不是合法 JSON/);
  assert.equal(result.droppedReasons[0].includes('DSML'), false);
});

test('filterValidToolCalls 对 id 与工具名做 trim', () => {
  const result = filterValidToolCalls([toolCall(' call_1 ', ' read_file ')]);

  assert.deepEqual(result.valid, [toolCall('call_1', 'read_file')]);
});

test('filterValidToolCalls 容忍 delta 归并产生的稀疏数组空洞', () => {
  const sparse: ReturnType<typeof toolCall>[] = [];
  // 上游 delta 的 index 不连续时，归并结果会在前面留下空洞。
  sparse[1] = toolCall('call_2', 'read_file');

  const result = filterValidToolCalls(sparse);

  assert.deepEqual(result.valid, [toolCall('call_2', 'read_file')]);
  assert.equal(result.droppedReasons.length, 1);
  assert.match(result.droppedReasons[0], /结构不完整/);
});

test('filterValidToolCalls 丢弃缺少 function 字段的 tool_call', () => {
  const result = filterValidToolCalls([{ id: 'call_1', type: 'function' } as never]);

  assert.deepEqual(result.valid, []);
  assert.match(result.droppedReasons[0], /结构不完整/);
});

const pairedHistory: ChatCompletionApiMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: '你好' },
  { role: 'assistant', content: null, tool_calls: [toolCall('call_1', 'read_file'), toolCall('call_2', 'list_dir')] },
  { role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: '{"ok":true}' },
  { role: 'tool', tool_call_id: 'call_2', name: 'list_dir', content: '{"ok":true}' },
  { role: 'assistant', content: '完成' },
];

test('dropOrphanToolMessages 对正常配对历史零改动且幂等', () => {
  const snapshot = JSON.stringify(pairedHistory);
  const first = dropOrphanToolMessages(pairedHistory);

  assert.deepEqual(first.droppedToolCallIds, []);
  assert.deepEqual(first.messages, pairedHistory);
  assert.equal(JSON.stringify(pairedHistory), snapshot, '不应修改入参');

  const second = dropOrphanToolMessages(first.messages);
  assert.deepEqual(second.messages, first.messages);
  assert.deepEqual(second.droppedToolCallIds, []);
});

test('dropOrphanToolMessages 丢弃没有对应 tool_use 的 tool 消息', () => {
  const result = dropOrphanToolMessages([
    { role: 'user', content: '你好' },
    { role: 'tool', tool_call_id: 'call_00_71yb', name: 'mcp_0_1', content: '{"ok":false}' },
    { role: 'assistant', content: '完成' },
  ]);

  assert.deepEqual(result.droppedToolCallIds, ['call_00_71yb']);
  assert.deepEqual(result.messages, [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '完成' },
  ]);
});

test('dropOrphanToolMessages 移除没有结果的 tool_calls 项', () => {
  const result = dropOrphanToolMessages([
    { role: 'assistant', content: null, tool_calls: [toolCall('call_1', 'read_file'), toolCall('call_2', 'list_dir')] },
    { role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: '{"ok":true}' },
  ]);

  assert.deepEqual(result.messages[0].tool_calls, [toolCall('call_1', 'read_file')]);
  assert.equal(result.messages.length, 2);
});

test('dropOrphanToolMessages 丢弃 tool_calls 全部无结果且正文为空的 assistant 消息', () => {
  const result = dropOrphanToolMessages([
    { role: 'user', content: '你好' },
    { role: 'assistant', content: null, tool_calls: [toolCall('call_1', 'read_file')] },
    { role: 'assistant', content: '兜底回复' },
  ]);

  assert.deepEqual(result.messages, [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '兜底回复' },
  ]);
});

test('dropOrphanToolMessages 保留有正文的 assistant 消息但剥掉无结果的 tool_calls', () => {
  const result = dropOrphanToolMessages([
    { role: 'assistant', content: '我先查一下', tool_calls: [toolCall('call_1', 'read_file')] },
  ]);

  assert.deepEqual(result.messages, [{ role: 'assistant', content: '我先查一下' }]);
});

test('dropOrphanToolMessages 对不含工具消息的历史是空操作', () => {
  const plain: ChatCompletionApiMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好呀' },
  ];

  const result = dropOrphanToolMessages(plain);
  assert.deepEqual(result.messages, plain);
  assert.deepEqual(result.droppedToolCallIds, []);
});

test('dropOrphanToolMessages 要求 tool 结果紧随对应的 assistant 消息', () => {
  const result = dropOrphanToolMessages([
    { role: 'assistant', content: null, tool_calls: [toolCall('call_1', 'read_file')] },
    { role: 'user', content: '插话' },
    { role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: '{"ok":true}' },
  ]);

  assert.deepEqual(result.droppedToolCallIds, ['call_1']);
  assert.deepEqual(result.messages, [{ role: 'user', content: '插话' }]);
});

function toolPayload(payload: Record<string, unknown>) {
  return JSON.stringify(payload);
}

test('compactToolMessageContent 丢掉 data 并截断正文，保留状态与参数摘要', () => {
  const body = `请求地址: https://example.com\nHTTP 状态: 200 OK\n${'x'.repeat(9000)}`;
  const raw = toolPayload({
    ok: true,
    content: body,
    data: { url: 'https://example.com', bodyPreview: body, responseHeaders: { server: 'nginx' } },
    summary: 'http_request({"url":"https://example.com"})',
  });

  const compacted = compactToolMessageContent(raw, 200);
  const parsed = JSON.parse(compacted) as Record<string, unknown>;

  assert.equal(parsed.ok, true);
  assert.equal(parsed.summary, 'http_request({"url":"https://example.com"})');
  assert.equal(parsed.data, undefined, 'data 不应保留，它与 content 重复');
  assert.equal(parsed.truncatedForDisplay, true);
  assert.ok((parsed.content as string).startsWith('请求地址: https://example.com'));
  assert.ok((parsed.content as string).endsWith('…[已截断，完整内容见日志]'));
  assert.ok(compacted.length < raw.length / 10, '压缩后应显著小于原始载荷');
});

test('compactToolMessageContent 未超长时不追加截断标记', () => {
  const raw = toolPayload({ ok: true, content: '短结果', summary: 'read_file({})' });
  const parsed = JSON.parse(compactToolMessageContent(raw, 200)) as Record<string, unknown>;

  assert.equal(parsed.content, '短结果');
  assert.equal(parsed.truncatedForDisplay, undefined);
});

test('compactToolMessageContent 在 content 为空时回退到 data', () => {
  const raw = toolPayload({ ok: true, content: '', data: { rows: [1, 2, 3] }, summary: 'read_excel({})' });
  const parsed = JSON.parse(compactToolMessageContent(raw, 200)) as Record<string, unknown>;

  assert.equal(parsed.content, '{"rows":[1,2,3]}');
});

test('compactToolMessageContent 保留失败原因', () => {
  const raw = toolPayload({ ok: false, content: '', error: '网络请求失败：fetch failed', summary: 'http_request({})' });
  const parsed = JSON.parse(compactToolMessageContent(raw, 200)) as Record<string, unknown>;

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, '网络请求失败：fetch failed');
});

test('compactToolMessageContent 对非工具载荷的字符串按原样截断', () => {
  assert.equal(compactToolMessageContent('不是 JSON', 200), '不是 JSON');
  assert.equal(compactToolMessageContent(JSON.stringify({ foo: 'bar' }), 200), '{"foo":"bar"}');

  const long = 'y'.repeat(500);
  const compacted = compactToolMessageContent(long, 200);
  assert.ok(compacted.startsWith('y'.repeat(200)));
  assert.ok(compacted.endsWith('…[已截断，完整内容见日志]'));
});

test('summarizeMessagesForDiagnostics 标注 ORPHAN 与 UNANSWERED 并只输出结构信息', () => {
  const messages: ChatCompletionApiMessage[] = [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '请读文件' },
    {
      role: 'assistant',
      content: '',
      reasoning_content: '思考',
      tool_calls: [toolCall('call_1', 'code_read_file', '{"filePath":"a.ts"}'), toolCall('call_2', 'code_glob')],
    },
    { role: 'tool', content: '{"ok":true}', tool_call_id: 'call_1', name: 'code_read_file' },
    { role: 'tool', content: '{"ok":true}', tool_call_id: 'call_missing', name: 'code_glob' },
  ];

  const lines = summarizeMessagesForDiagnostics(messages);

  assert.equal(lines.length, 5);
  assert.match(lines[2], /#2 assistant content=0B reasoning=6B\(已剥离\)/);
  assert.match(lines[2], /call_1:code_read_file\(args=19B\)/);
  // call_2 没有对应的 tool 结果
  assert.match(lines[2], /call_2:code_glob\(args=2B\) UNANSWERED/);
  assert.doesNotMatch(lines[3], /ORPHAN/);
  // tool_call_id 不在上一条 assistant 的 tool_calls 里
  assert.match(lines[4], /tool_call_id=call_missing.*ORPHAN/);
  // 不能把正文写进日志
  assert.doesNotMatch(lines.join('\n'), /你是助手|请读文件|filePath/);
});

test('summarizeMessagesForDiagnostics 只保留最近若干条并说明总数', () => {
  const messages: ChatCompletionApiMessage[] = Array.from({ length: 5 }, (_, index) => ({
    role: 'user' as const,
    content: `m${index}`,
  }));

  const lines = summarizeMessagesForDiagnostics(messages, 2);

  assert.equal(lines.length, 3);
  assert.match(lines[0], /共 5 条，仅列出最近 2 条/);
  assert.match(lines[1], /^#3 user/);
  assert.match(lines[2], /^#4 user/);
});

test('summarizeMessagesForDiagnostics 描述多模态 content 的构成', () => {
  const lines = summarizeMessagesForDiagnostics([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    },
  ]);

  assert.match(lines[0], /content=\[text\+image\] text=2B/);
});

test('toUpstreamMessages 剥掉本地字段并保留工具配对字段', () => {
  const messages: ChatCompletionApiMessage[] = [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      reasoning_content: '一大段思考文本',
      tool_calls: [toolCall('call_1', 'read_file')],
    },
    {
      id: 'tool-1',
      role: 'tool',
      content: '{"ok":true}',
      tool_call_id: 'call_1',
      name: 'read_file',
    },
    {
      id: 'user-1',
      role: 'user',
      content: '继续',
      attachments: [{ id: 'att-1', fileName: 'a.pdf', originalName: 'a.pdf', kind: 'pdf', mimeType: 'application/pdf', size: 1, createdAt: 'x' }],
    },
  ];

  const upstream = toUpstreamMessages(messages);

  assert.deepEqual(upstream, [
    { role: 'assistant', content: '', tool_calls: [toolCall('call_1', 'read_file')] },
    { role: 'tool', content: '{"ok":true}', tool_call_id: 'call_1', name: 'read_file' },
    { role: 'user', content: '继续' },
  ]);
  // 不能就地改写调用方的消息数组：会话历史仍要保留 reasoning_content 用于界面展示
  assert.equal(messages[0].reasoning_content, '一大段思考文本');
  assert.equal(messages[0].id, 'assistant-1');
});

test('toUpstreamMessages 丢弃无正文且无 tool_calls 的空 assistant 消息（GLM content is required 兼容）', () => {
  const upstream = toUpstreamMessages([
    { role: 'user', content: '第一问' },
    { role: 'assistant', content: null, reasoning_content: '纯思考没有输出' },
    { role: 'assistant', content: '' },
    { role: 'user', content: '第二问' },
  ]);

  assert.deepEqual(upstream, [
    { role: 'user', content: '第一问' },
    { role: 'user', content: '第二问' },
  ]);
});

test('toUpstreamMessages 把带 tool_calls 的 assistant null content 补成空字符串', () => {
  const upstream = toUpstreamMessages([
    { role: 'assistant', content: null, tool_calls: [toolCall('call_1', 'read_file')] },
    { role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: '{"ok":true}' },
  ]);

  assert.deepEqual(upstream, [
    { role: 'assistant', content: '', tool_calls: [toolCall('call_1', 'read_file')] },
    { role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: '{"ok":true}' },
  ]);
});

test('toToolMessage 不把 data 冗余进模型消息', () => {
  const result: ToolResult = {
    ok: true,
    content: '场景信息 JSON',
    data: { content: [{ type: 'text', text: '场景信息 JSON' }] },
  };

  const message = toToolMessage(toolCall('call_1', 'mcp_0_5'), result, 'mcp_0_5({})');

  assert.equal(message.role, 'tool');
  assert.equal(message.tool_call_id, 'call_1');
  assert.equal(message.name, 'mcp_0_5');
  assert.equal(typeof message.content, 'string');
  const parsed = JSON.parse(message.content as string) as Record<string, unknown>;
  assert.equal(parsed.ok, true);
  assert.equal(parsed.content, '场景信息 JSON');
  assert.equal(parsed.summary, 'mcp_0_5({})');
  assert.equal(parsed.data, undefined, 'data 是 content 的重复序列化，不应发给模型');
});

test('toToolMessage 把图片转成 image_url 内容块，base64 不再进文本', () => {
  const dataUrl = 'data:image/png;base64,QUJD';
  const result: ToolResult = {
    ok: true,
    content: '[该工具返回了 1 张图片，已作为图片内容附带]',
    images: [dataUrl],
  };

  const message = toToolMessage(toolCall('call_1', 'mcp_0_3'), result, 'mcp_0_3({})');

  assert.ok(Array.isArray(message.content));
  const parts = message.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
  assert.equal(parts.length, 2);
  assert.equal(parts[0].type, 'text');
  assert.equal(parts[1].type, 'image_url');
  assert.equal(parts[1].image_url?.url, dataUrl);
  // 文本载荷里绝不能出现 base64
  assert.equal(parts[0].text?.includes('QUJD'), false);
});

test('toToolMessage 限制附带图片数量并记录丢弃数', () => {
  const images = Array.from({ length: maxToolResultImages + 2 }, (_, index) => `data:image/png;base64,${index}`);
  const result: ToolResult = { ok: true, content: '', images };

  const message = toToolMessage(toolCall('call_1', 'mcp_0_3'), result, 'mcp_0_3({})');
  const parts = message.content as Array<{ type: string; text?: string }>;

  assert.equal(parts.filter((part) => part.type === 'image_url').length, maxToolResultImages);
  const textPart = parts.find((part) => part.type === 'text');
  const parsed = JSON.parse(textPart?.text ?? '') as Record<string, unknown>;
  assert.equal(parsed.imagesDropped, 2);
});

test('toToolMessage 丢弃超限体积的图片', () => {
  const oversized = `data:image/png;base64,${'A'.repeat(maxToolResultImageChars)}`;
  const normal = 'data:image/png;base64,QUJD';
  const result: ToolResult = { ok: true, content: '', images: [oversized, normal] };

  const message = toToolMessage(toolCall('call_1', 'mcp_0_3'), result, 'mcp_0_3({})');
  const parts = message.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;

  const imageUrls = parts.filter((part) => part.type === 'image_url').map((part) => part.image_url?.url);
  assert.deepEqual(imageUrls, [normal]);
  const textPart = parts.find((part) => part.type === 'text');
  const parsed = JSON.parse(textPart?.text ?? '') as Record<string, unknown>;
  assert.equal(parsed.imagesDropped, 1);
});

test('toToolMessage 保留失败结果与错误信息', () => {
  const message = toToolMessage(toolCall('call_1', 'mcp_0_5'), { ok: false, content: '', error: '连接失败' }, 'mcp_0_5({})');

  const parsed = JSON.parse(message.content as string) as Record<string, unknown>;
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, '连接失败');
});

test('hasToolImageContent 只在 tool 消息携带数组 content 时为真', () => {
  const toolWithImages: ChatCompletionApiMessage = {
    role: 'tool',
    tool_call_id: 'call_1',
    name: 'mcp_0_3',
    content: [
      { type: 'text', text: '{"ok":true}' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ],
  };
  const toolTextOnly: ChatCompletionApiMessage = { role: 'tool', tool_call_id: 'call_2', name: 'read_file', content: '{"ok":true}' };
  const userWithImage: ChatCompletionApiMessage = {
    role: 'user',
    content: [
      { type: 'text', text: '看这张图' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ],
  };

  assert.equal(hasToolImageContent([toolTextOnly, userWithImage]), false);
  assert.equal(hasToolImageContent([toolWithImages]), true);
});

test('moveToolImagesToUserMessage 把 tool 图片挪到末尾 user 消息并保留文本与配对字段', () => {
  const toolMessage: ChatCompletionApiMessage = {
    role: 'tool',
    tool_call_id: 'call_1',
    name: 'mcp_0_3',
    content: [
      { type: 'text', text: '{"ok":true,"summary":"mcp_0_3({})"}' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ],
  };
  const messages: ChatCompletionApiMessage[] = [
    { role: 'user', content: '截图看看' },
    { role: 'assistant', content: '', tool_calls: [toolCall('call_1', 'mcp_0_3')] },
    toolMessage,
  ];

  const converted = moveToolImagesToUserMessage(messages);

  assert.equal(converted.length, 4);
  // tool 消息退化为纯文本，保留配对字段
  assert.equal(converted[2].role, 'tool');
  assert.equal(converted[2].tool_call_id, 'call_1');
  assert.equal(converted[2].name, 'mcp_0_3');
  assert.equal(converted[2].content, '{"ok":true,"summary":"mcp_0_3({})"}');
  // 图片进入末尾 user 消息
  const last = converted[3];
  assert.equal(last.role, 'user');
  const parts = last.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
  assert.equal(parts[0].type, 'text');
  assert.match(parts[0].text ?? '', /工具调用（mcp_0_3）/);
  assert.equal(parts[1].image_url?.url, 'data:image/png;base64,QUJD');
  // 不再含 tool 图片，避免二次回退
  assert.equal(hasToolImageContent(converted), false);
});

test('moveToolImagesToUserMessage 对无 tool 图片的消息原样返回', () => {
  const messages: ChatCompletionApiMessage[] = [
    { role: 'user', content: '普通对话' },
    { role: 'assistant', content: '好的' },
  ];

  assert.equal(moveToolImagesToUserMessage(messages), messages);
});

test('moveToolImagesToUserMessage 对空文本 tool 消息补占位说明', () => {
  const converted = moveToolImagesToUserMessage([
    {
      role: 'tool',
      tool_call_id: 'call_1',
      name: 'mcp_0_3',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }],
    },
  ]);

  assert.equal(converted.length, 2);
  assert.match(converted[0].content as string, /返回结果见下方图片/);
});

test('extractBase64ImagesFromText 提取 JSON 里夹带的 JPEG base64 且保持 JSON 可解析', () => {
  const jpegRun = `/9j/${'A'.repeat(600)}`;
  const raw = `{"status":"ok","result":{"rendered":true,"path":"/tmp/car.jpg","bytes":89996,"base64":"${jpegRun}"}}`;

  const { text, images } = extractBase64ImagesFromText(raw);

  assert.equal(images.length, 1);
  assert.equal(images[0], `data:image/jpeg;base64,${jpegRun}`);
  // 替换后 JSON 结构完好，模型仍能读到其余字段
  const parsed = JSON.parse(text) as { result: { base64: string; rendered: boolean } };
  assert.equal(parsed.result.rendered, true);
  assert.match(parsed.result.base64, /base64 图片数据已提取为图片内容/);
  assert.equal(text.includes('A'.repeat(100)), false, 'base64 不得残留在文本里');
});

test('extractBase64ImagesFromText 按 base64 魔数前缀识别 PNG', () => {
  const pngRun = `iVBORw0KGgo${'B'.repeat(600)}`;
  const { text, images } = extractBase64ImagesFromText(`data=${pngRun}`);

  assert.equal(images[0], `data:image/png;base64,${pngRun}`);
  assert.match(text, /data=\[base64 图片数据已提取为图片内容/);
});

test('extractBase64ImagesFromText 对识别不出图片的 base64 整段截断', () => {
  const unknownRun = 'Z'.repeat(800);
  const { text, images } = extractBase64ImagesFromText(`blob: ${unknownRun}`);

  assert.deepEqual(images, []);
  assert.equal(text, 'blob: [已省略 800 字符的 base64 数据]');
});

test('extractBase64ImagesFromText 一段文本里的多张图片都被提取', () => {
  const jpeg1 = `/9j/${'A'.repeat(600)}`;
  const jpeg2 = `/9j/${'B'.repeat(600)}`;
  const { images } = extractBase64ImagesFromText(`first:${jpeg1} second:${jpeg2}`);

  assert.equal(images.length, 2);
  assert.equal(images[0].endsWith(`${'A'.repeat(600)}`), true);
  assert.equal(images[1].endsWith(`${'B'.repeat(600)}`), true);
});

test('extractBase64ImagesFromText 不动正常代码与中文文本', () => {
  const code = `function x() { return '${'a'.repeat(400)}'; } // ${'中'.repeat(100)}`;
  const { text, images } = extractBase64ImagesFromText(code);

  assert.deepEqual(images, []);
  assert.equal(text, code);
});

test('extractBase64ImagesFromText 对短文本直接原样返回', () => {
  assert.deepEqual(extractBase64ImagesFromText('{"ok":true}'), { text: '{"ok":true}', images: [] });
  assert.deepEqual(extractBase64ImagesFromText(''), { text: '', images: [] });
});
