import type { ToolCall } from '../../shared/agent';
import type { ToolResult } from '../../shared/tools';
import type { ChatCompletionApiMessage, ImageContentPart, TextContentPart } from '../agent/deepseek-client';

export type ToolCallFilterResult = {
  valid: ToolCall[];
  droppedReasons: string[];
};

function isParsableArguments(rawArguments: string) {
  const trimmed = rawArguments.trim();
  if (!trimmed) {
    // 无参工具调用，合法。
    return true;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

// 上游网关可能把模型的函数调用格式解析坏（缺 id、重复 id、arguments 混入内部标记），
// 这类 tool_call 一旦进入历史，下一轮请求会因 tool_result 找不到对应 tool_use 被拒。
export function filterValidToolCalls(toolCalls: ToolCall[]): ToolCallFilterResult {
  const valid: ToolCall[] = [];
  const droppedReasons: string[] = [];
  const seenIds = new Set<string>();

  for (const [index, toolCall] of toolCalls.entries()) {
    // 流式 delta 的 index 可能不连续，归并后的数组会出现空洞。
    if (!toolCall?.function) {
      droppedReasons.push(`index=${index} tool_call 结构不完整`);
      continue;
    }

    const id = toolCall.id?.trim() ?? '';
    const name = toolCall.function.name?.trim() ?? '';
    const rawArguments = toolCall.function.arguments ?? '';

    if (!id) {
      droppedReasons.push(`index=${index} 缺少 tool_call id`);
      continue;
    }

    if (!name) {
      droppedReasons.push(`id=${id} 缺少工具名`);
      continue;
    }

    if (seenIds.has(id)) {
      droppedReasons.push(`id=${id} 重复`);
      continue;
    }

    if (!isParsableArguments(rawArguments)) {
      droppedReasons.push(`id=${id} tool=${name} 参数不是合法 JSON`);
      continue;
    }

    seenIds.add(id);
    valid.push({
      id,
      type: toolCall.type ?? 'function',
      function: {
        name,
        arguments: rawArguments,
      },
    });
  }

  return { valid, droppedReasons };
}

export type OrphanToolMessageResult = {
  messages: ChatCompletionApiMessage[];
  droppedToolCallIds: string[];
};

function hasContent(content: ChatCompletionApiMessage['content']) {
  if (Array.isArray(content)) {
    return content.length > 0;
  }

  return typeof content === 'string' ? content.trim().length > 0 : false;
}

// tool_result 必须紧随对应的 tool_use，否则模型网关会拒绝整个请求。
// 这里在发送前做一次配对自愈：丢弃孤儿 tool 消息，并移除没有结果的 tool_calls。
export function dropOrphanToolMessages(messages: ChatCompletionApiMessage[]): OrphanToolMessageResult {
  const droppedToolCallIds: string[] = [];
  const answeredIds = new Set<string>();
  const kept: ChatCompletionApiMessage[] = [];
  let pendingIds = new Set<string>();

  for (const message of messages) {
    if (message.role === 'tool') {
      const toolCallId = message.tool_call_id?.trim() ?? '';
      if (!toolCallId || !pendingIds.has(toolCallId)) {
        droppedToolCallIds.push(toolCallId);
        continue;
      }

      answeredIds.add(toolCallId);
      kept.push(message);
      continue;
    }

    if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
      pendingIds = new Set(message.tool_calls.map((toolCall) => toolCall?.id?.trim() ?? '').filter(Boolean));
    } else {
      pendingIds = new Set();
    }

    kept.push(message);
  }

  const result: ChatCompletionApiMessage[] = [];
  for (const message of kept) {
    if (message.role !== 'assistant' || !message.tool_calls || message.tool_calls.length === 0) {
      result.push(message);
      continue;
    }

    const answeredToolCalls = message.tool_calls.filter((toolCall) => answeredIds.has(toolCall?.id?.trim() ?? ''));
    if (answeredToolCalls.length === message.tool_calls.length) {
      result.push(message);
      continue;
    }

    if (answeredToolCalls.length === 0) {
      if (!hasContent(message.content)) {
        continue;
      }

      const { tool_calls: _toolCalls, ...rest } = message;
      result.push(rest);
      continue;
    }

    result.push({ ...message, tool_calls: answeredToolCalls });
  }

  return { messages: result, droppedToolCallIds };
}

/**
 * 剥掉只在本地有意义的字段，再发给上游。
 *
 * - `id` 是渲染层用来定位流式消息的本地标识，对模型没有意义。
 * - `attachments` 只是附件元数据，正文已在预处理阶段并入 content。
 * - `reasoning_content` 是上游返回的思考文本，回传既无意义也有害：DeepSeek 明确要求
 *   不要把它带进下一轮；Anthropic 系的 thinking 块必须带 signature，网关拿一段没有
 *   signature 的纯文本重建 thinking 时可能挤掉同一条消息里的 tool_use，导致下一条
 *   tool_result 找不到配对（TOOL_USE_RESULT_MISMATCH）。
 *
 * 同时做 content 兼容性归一：部分网关（如 GLM/bigmodel）校验 assistant 消息的
 * content 必填，历史里 content 为 null 的消息（纯思考响应流式落空时产生）会导致
 * 整个请求被拒（"message[N].content is required"）。
 * - assistant 无正文且无 tool_calls：整条丢弃，对模型没有信息量；
 * - assistant 无正文但有 tool_calls：content 补成空字符串，保住 tool_use 配对；
 * - 其余角色的 null content 兜底为空字符串。
 */
export function toUpstreamMessages(messages: ChatCompletionApiMessage[]): ChatCompletionApiMessage[] {
  const result: ChatCompletionApiMessage[] = [];

  for (const raw of messages) {
    const {
      id: _id,
      attachments: _attachments,
      reasoning_content: _reasoningContent,
      ...message
    } = raw;

    if (message.role === 'assistant' && !hasContent(message.content)) {
      if (message.tool_calls && message.tool_calls.length > 0) {
        result.push({ ...message, content: '' });
      }
      // 无正文也无 tool_calls 的空 assistant 消息直接丢弃
      continue;
    }

    if (message.content === null || message.content === undefined) {
      result.push({ ...message, content: '' });
      continue;
    }

    result.push(message);
  }

  return result;
}

/** 诊断日志里最多列出的消息条数，只保留最近的部分。 */
export const diagnosticsMessageLimit = 50;

function formatByteSize(value: string) {
  const bytes = Buffer.byteLength(value, 'utf8');
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

function describeContent(content: ChatCompletionApiMessage['content']) {
  if (content === null || content === undefined) {
    return 'content=null';
  }

  if (Array.isArray(content)) {
    const kinds = content.map((part) => (part.type === 'image_url' ? 'image' : 'text'));
    const textBytes = content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .reduce((total, part) => total + Buffer.byteLength(part.text, 'utf8'), 0);
    return `content=[${kinds.join('+')}] text=${textBytes}B`;
  }

  return `content=${formatByteSize(content)}`;
}

/**
 * 把即将发给上游的消息数组压成可读的骨架，用于请求失败后的事后排查。
 *
 * 只输出结构信息（role、字节数、tool_call 配对关系），不输出正文，避免日志泄漏代码内容。
 * 同时就地标注两类配对异常：ORPHAN（tool_result 找不到前一条消息里的 tool_use）
 * 与 UNANSWERED（tool_use 没有对应的 tool_result），这样一眼就能区分是我们发错了
 * 还是上游网关在转换时弄坏了消息。
 */
export function summarizeMessagesForDiagnostics(
  messages: ChatCompletionApiMessage[],
  limit = diagnosticsMessageLimit,
): string[] {
  const answeredIds = new Set(
    messages
      .filter((message) => message.role === 'tool')
      .map((message) => message.tool_call_id?.trim() ?? '')
      .filter(Boolean),
  );

  const startIndex = Math.max(messages.length - limit, 0);
  const lines = startIndex > 0 ? [`（共 ${messages.length} 条，仅列出最近 ${messages.length - startIndex} 条）`] : [];
  let pendingIds = new Set<string>();

  for (const [index, message] of messages.entries()) {
    const parts = [`#${index}`, message.role, describeContent(message.content)];

    if (message.reasoning_content) {
      // 发送前会被 toUpstreamMessages 剥掉，这里标出来是为了确认剥除是否生效
      parts.push(`reasoning=${formatByteSize(message.reasoning_content)}(已剥离)`);
    }

    if (message.role === 'tool') {
      const toolCallId = message.tool_call_id?.trim() ?? '';
      parts.push(`tool_call_id=${toolCallId || '(空)'}`);
      if (message.name) {
        parts.push(`name=${message.name}`);
      }
      if (!toolCallId || !pendingIds.has(toolCallId)) {
        parts.push('ORPHAN');
      }
    } else if (message.tool_calls && message.tool_calls.length > 0) {
      const described = message.tool_calls.map((toolCall) => {
        const id = toolCall?.id?.trim() ?? '(空)';
        const name = toolCall?.function?.name ?? '(无)';
        const size = formatByteSize(toolCall?.function?.arguments ?? '');
        return `${id}:${name}(args=${size})${answeredIds.has(id) ? '' : ' UNANSWERED'}`;
      });
      parts.push(`tool_calls=[${described.join(', ')}]`);
      pendingIds = new Set(message.tool_calls.map((toolCall) => toolCall?.id?.trim() ?? '').filter(Boolean));
    } else {
      pendingIds = new Set();
    }

    if (index >= startIndex) {
      lines.push(parts.join(' '));
    }
  }

  return lines;
}

/** 会话区里工具结果的展示上限。超出部分只影响显示，发给模型的消息仍是完整内容。 */
export const displayToolContentLimit = 600;

/** 单个工具结果最多附带的图片数。截图类工具连续返回时防止请求体被撑爆。 */
export const maxToolResultImages = 3;
/** 单张图片 data URL 的字符上限（约 1.9MB 二进制）。超出的直接丢弃并留说明。 */
export const maxToolResultImageChars = 2_600_000;

/** 文本中被视为 base64 数据的最小连续长度。低于该值按普通内容处理。 */
const minBase64RunLength = 512;

const longBase64RunPattern = new RegExp(`[A-Za-z0-9+/]{${minBase64RunLength},}={0,2}`, 'g');

/** base64 编码的图片魔数前缀 → MIME。只认前缀能确定的格式，认不出就不当图片。 */
const imageMimeByBase64Prefix: ReadonlyArray<[prefix: string, mime: string]> = [
  ['iVBORw0KGgo', 'image/png'],
  ['/9j/', 'image/jpeg'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
];

function detectImageMimeFromBase64Run(run: string) {
  for (const [prefix, mime] of imageMimeByBase64Prefix) {
    if (run.startsWith(prefix)) {
      return mime;
    }
  }
  return null;
}

/**
 * 把工具结果文本里夹带的长 base64 数据提取或截断。
 *
 * execute_blender_code 这类"返回脚本 result 变量"的工具会让模型把渲染图
 * 以 base64 塞进文本结果（实测一张 900p JPEG 就是 12 万字符），随消息
 * 原样发给模型后会把请求拖到数分钟无响应，最后连接被掐断（报 terminated）。
 * - 前缀能识别出图片魔数的：转成 data URL 提取为图片，走 image_url 内容块
 *   与会话区预览，模型与用户都能看到图，token 按视觉编码计；
 * - 识别不出的：整段替换为长度说明，无论来源都保住 prompt。
 */
export function extractBase64ImagesFromText(text: string): { text: string; images: string[] } {
  if (!text || text.length < minBase64RunLength) {
    return { text, images: [] };
  }

  const images: string[] = [];
  const replaced = text.replace(longBase64RunPattern, (run) => {
    const mime = detectImageMimeFromBase64Run(run);
    if (mime) {
      images.push(`data:${mime};base64,${run}`);
      return `[base64 图片数据已提取为图片内容（约 ${Math.round((run.length * 3) / 4 / 1024)}KB）]`;
    }
    return `[已省略 ${run.length} 字符的 base64 数据]`;
  });

  return { text: replaced, images };
}

/**
 * 把工具执行结果转成回传给模型的 tool 消息。
 *
 * - `data` 只服务于本地诊断与展示，不进模型消息：它是 content 的重复序列化，
 *   MCP 大结果（截图、场景 JSON）会被原样翻倍计入 prompt。
 * - 带图片时（MCP 截图等）content 是 [text, image_url...] 数组，token 按视觉编码计，
 *   远小于 base64 文本。网关不支持 tool 角色带数组 content 时，由 deepseek-client
 *   自动回退为 user 消息带图（moveToolImagesToUserMessage）。
 */
export function toToolMessage(toolCall: ToolCall, result: ToolResult, summary: string): ChatCompletionApiMessage {
  const payload: Record<string, unknown> = {
    ok: result.ok,
    ...(result.content ? { content: result.content } : {}),
    ...(result.error ? { error: result.error } : {}),
    summary,
  };

  const images = (result.images ?? []).filter((url) => typeof url === 'string' && url.startsWith('data:'));
  const kept: string[] = [];
  let droppedCount = 0;

  for (const url of images) {
    if (kept.length >= maxToolResultImages || url.length > maxToolResultImageChars) {
      droppedCount += 1;
      continue;
    }
    kept.push(url);
  }

  if (droppedCount > 0) {
    payload.imagesDropped = droppedCount;
  }

  const textContent = JSON.stringify(payload);

  if (kept.length === 0) {
    return {
      role: 'tool',
      tool_call_id: toolCall.id,
      name: toolCall.function.name,
      content: textContent,
    };
  }

  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    name: toolCall.function.name,
    content: [
      { type: 'text', text: textContent },
      ...kept.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ],
  };
}

/** 请求里是否存在携带多模态数组 content 的 tool 消息。 */
export function hasToolImageContent(messages: ChatCompletionApiMessage[]): boolean {
  return messages.some((message) => message.role === 'tool' && Array.isArray(message.content));
}

/**
 * 兼容回退：把 tool 消息里的 image_url 内容块抽出来，挪到末尾一条 user 消息。
 * 部分网关（含 GLM/bigmodel）不接受 tool 角色携带多模态数组 content，
 * 但 user 角色的 image_url 是 OpenAI 兼容端点通用的。
 */
export function moveToolImagesToUserMessage(messages: ChatCompletionApiMessage[]): ChatCompletionApiMessage[] {
  const result: ChatCompletionApiMessage[] = [];
  const collected: ImageContentPart[] = [];
  const toolNames: string[] = [];

  for (const message of messages) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      result.push(message);
      continue;
    }

    const text = message.content
      .filter((part): part is TextContentPart => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    const imageParts = message.content.filter((part): part is ImageContentPart => part.type === 'image_url');
    collected.push(...imageParts);
    if (message.name) {
      toolNames.push(message.name);
    }
    result.push({
      ...message,
      content: text.trim() || `[工具 ${message.name ?? ''} 的返回结果见下方图片]`,
    });
  }

  if (collected.length === 0) {
    return messages;
  }

  result.push({
    role: 'user',
    content: [
      {
        type: 'text',
        text: `[以下 ${collected.length} 张图片是工具调用${toolNames.length ? `（${toolNames.join('、')}）` : ''}的返回结果]`,
      },
      ...collected,
    ],
  });

  return result;
}
type ToolMessagePayload = {
  ok: boolean;
  content?: string;
  data?: unknown;
  error?: string;
  summary?: string;
};

function parseToolMessagePayload(rawContent: string): ToolMessagePayload | null {
  try {
    const parsed = JSON.parse(rawContent) as ToolMessagePayload;
    return typeof parsed === 'object' && parsed !== null && typeof parsed.ok === 'boolean' ? parsed : null;
  } catch {
    return null;
  }
}

/** 从工具结果 JSON 解析 ok 状态；无法解析（非标准结果）时返回 undefined，由调用方按成功处理。 */
export function parseToolMessageOk(rawContent: string): boolean | undefined {
  return parseToolMessagePayload(rawContent)?.ok;
}

function clip(text: string, limit: number) {
  const normalized = text.trim();
  return normalized.length <= limit
    ? { text: normalized, truncated: false }
    : { text: `${normalized.slice(0, limit)}\n…[已截断，完整内容见日志]`, truncated: true };
}

/**
 * 压缩工具结果，仅用于会话区展示。
 *
 * 网络类工具单次可返回 8000 字符正文，且 data.bodyPreview 与 content 重复一份，
 * 一轮调研几十次调用就会把消息流撑爆。这里丢掉 data、截断正文，
 * 保留 ok/summary/error 让界面仍能显示状态与参数摘要并折叠展开。
 */
export function compactToolMessageContent(rawContent: string, limit = displayToolContentLimit) {
  const payload = parseToolMessagePayload(rawContent);

  if (!payload) {
    return clip(rawContent, limit).text;
  }

  const rawBody = payload.content?.trim()
    || (payload.data === undefined ? '' : JSON.stringify(payload.data));
  const { text, truncated } = clip(rawBody, limit);

  return JSON.stringify({
    ok: payload.ok,
    summary: payload.summary,
    content: text,
    error: payload.error,
    ...(truncated ? { truncatedForDisplay: true } : {}),
  });
}
