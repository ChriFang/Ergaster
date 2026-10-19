import type { AppConfig } from '../../shared/config';
import { sanitizeConfig } from '../../shared/config';
import type { AttachmentMeta } from '../../shared/attachment';
import type { ChatCompletionTool, ToolCall } from '../../shared/agent';
import { appendMainLog } from '../core/audit-log';
import { dumpChatRequestIfEnabled } from '../core/debug-config';
import { dropOrphanToolMessages, filterValidToolCalls, hasToolImageContent, moveToolImagesToUserMessage, summarizeMessagesForDiagnostics, toUpstreamMessages } from '../tools/tool-call-utils';
import { clipLogText, createIdleDeadline } from '../tools/tool-helpers';
import type { IdleDeadline } from '../tools/tool-helpers';
import { buildReasoningParams } from './reasoning-params';

export type TextContentPart = {
  type: 'text';
  text: string;
};

export type ImageContentPart = {
  type: 'image_url';
  image_url: { url: string };
};

export type ChatContentPart = TextContentPart | ImageContentPart;

export type ChatCompletionApiMessage = {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | ChatContentPart[];
  attachments?: AttachmentMeta[];
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
  reasoning_content?: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: ToolCall[];
      reasoning_content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type StreamToolCallDelta = {
  index?: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
};

type ChatCompletionStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: StreamToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
};

export type ChatCompletionStreamEvent = {
  deltaContent?: string;
  deltaReasoningContent?: string;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function toOneApiCompatibleTools(tools: ChatCompletionTool[]) {
  return tools.map((tool) => ({
    type: tool.type,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));
}

const MODEL_REQUEST_RETRY_COUNT = 1;

class ChatCompletionRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'ChatCompletionRequestError';
  }
}

/**
 * 空闲超时：只要还在出数据就会被 refresh，所以它约束的是"卡住不出字"的时长，
 * 而不是整次响应的总耗时。推理模型在长上下文下首 token 前的思考时间会吃掉这个预算。
 */
function createModelRequestDeadline(signal: AbortSignal, config: AppConfig) {
  const timeoutMs = sanitizeConfig(config).modelIdleTimeoutSeconds * 1000;

  return createIdleDeadline({
    signal,
    timeoutMs,
    timeoutMessage: `模型服务超过 ${Math.round(timeoutMs / 1000)} 秒没有返回新数据。可在设置中调大"模型响应空闲超时"。`,
  });
}

function isRetryableRequestMessage(message: string) {
  // terminated：连接在响应中途被掐断（undici 读流抛 TypeError: terminated），
  // 属于瞬时网络故障，请求阶段自动重试一次
  return /upstream service error|connection timed out|read: connection timed out|fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|terminated/i.test(message);
}

function toRequestError(error: unknown) {
  if (error instanceof ChatCompletionRequestError) {
    return error;
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new ChatCompletionRequestError(error.message || '模型服务请求超时。', false);
  }
  if (error instanceof Error) {
    return new ChatCompletionRequestError(error.message, isRetryableRequestMessage(error.message));
  }
  return new ChatCompletionRequestError('模型服务请求失败。', false);
}

function buildRequestBody(config: AppConfig, messages: ChatCompletionApiMessage[], tools: ChatCompletionTool[], stream: boolean) {
  const requestMessages = toUpstreamMessages(messages);
  const body: Record<string, unknown> = {
    model: config.model,
    messages: requestMessages,
    stream,
  };

  if (tools.length > 0) {
    body.tools = config.oneApiCompatibilityEnabled ? toOneApiCompatibleTools(tools) : tools;
  }

  Object.assign(body, buildReasoningParams(config));

  return JSON.stringify(body);
}

function getToolCallDeltaIndex(toolCalls: ToolCall[], deltaToolCall: StreamToolCallDelta) {
  if (typeof deltaToolCall.index === 'number') {
    return deltaToolCall.index;
  }

  if (deltaToolCall.id) {
    const existingIndex = toolCalls.findIndex((toolCall) => toolCall.id === deltaToolCall.id);
    if (existingIndex >= 0) {
      return existingIndex;
    }
  }

  if (toolCalls.length === 0) {
    return 0;
  }

  const lastIndex = toolCalls.length - 1;
  const hasNewCallIdentity = Boolean(deltaToolCall.id || deltaToolCall.function?.name);
  const lastCallHasName = Boolean(toolCalls[lastIndex]?.function.name);
  const lastCallHasArguments = Boolean(toolCalls[lastIndex]?.function.arguments);

  return hasNewCallIdentity && lastCallHasName && lastCallHasArguments ? toolCalls.length : lastIndex;
}

function mergeToolCallDelta(toolCalls: ToolCall[], deltaToolCalls: StreamToolCallDelta[]) {
  for (const deltaToolCall of deltaToolCalls) {
    const index = getToolCallDeltaIndex(toolCalls, deltaToolCall);
    const existing = toolCalls[index] ?? {
      id: '',
      type: 'function' as const,
      function: {
        name: '',
        arguments: '',
      },
    };

    toolCalls[index] = {
      id: deltaToolCall.id ?? existing.id,
      type: deltaToolCall.type ?? existing.type,
      function: {
        name: deltaToolCall.function?.name ?? existing.function.name,
        arguments: `${existing.function.arguments}${deltaToolCall.function?.arguments ?? ''}`,
      },
    };
  }

  return toolCalls;
}

function hasOnlyInvalidToolCalls(toolCalls: ToolCall[], validToolCalls: ToolCall[]) {
  return toolCalls.length > 0 && validToolCalls.length === 0;
}

async function parseErrorResponse(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return `模型服务请求失败：HTTP ${response.status} ${response.statusText}`;
  }

  try {
    const payload = JSON.parse(text) as ChatCompletionResponse;
    return payload.error?.message || `模型服务请求失败：HTTP ${response.status} ${text}`;
  } catch {
    return `模型服务请求失败：HTTP ${response.status} ${text}`;
  }
}

async function requestChatCompletion(options: {
  config: AppConfig;
  messages: ChatCompletionApiMessage[];
  tools: ChatCompletionTool[];
  stream: boolean;
  signal: AbortSignal;
  retryLabel: string;
}) {
  try {
    return await requestChatCompletionWithRetries(options);
  } catch (error) {
    const requestError = toRequestError(error);
    // tool 角色带图片被网关拒绝时，降级成 user 消息带图再试一次；
    // 降级后的消息已无 tool 图片，不会二次触发
    if (options.signal.aborted || requestError.retryable || !hasToolImageContent(options.messages)) {
      throw requestError;
    }

    await appendMainLog(
      'WARN',
      `${options.retryLabel} rejected with tool image content, retrying with images moved into a user message: ${requestError.message}`,
    );
    return requestChatCompletionWithRetries({
      ...options,
      messages: moveToolImagesToUserMessage(options.messages),
    });
  }
}

async function requestChatCompletionWithRetries(options: {
  config: AppConfig;
  messages: ChatCompletionApiMessage[];
  tools: ChatCompletionTool[];
  stream: boolean;
  signal: AbortSignal;
  retryLabel: string;
}) {
  const { config, messages, tools, stream, signal, retryLabel } = options;
  let lastError: ChatCompletionRequestError | null = null;

  // tool_result 必须紧随对应的 tool_use，否则整个请求会被模型网关拒绝。
  const { messages: requestMessages, droppedToolCallIds } = dropOrphanToolMessages(messages);
  if (droppedToolCallIds.length > 0) {
    await appendMainLog(
      'WARN',
      `Dropped ${droppedToolCallIds.length} orphan tool message(s) before request: ${droppedToolCallIds.join(', ')}`,
    );
  }

  for (let attempt = 0; attempt <= MODEL_REQUEST_RETRY_COUNT; attempt += 1) {
    // 每次尝试都用全新的 deadline；成功时把它交给调用方，由调用方在读完响应后 dispose。
    const deadline = createModelRequestDeadline(signal, config);

    try {
      const url = `${normalizeBaseUrl(config.apiBaseUrl)}/chat/completions`;
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseekApiKey}`,
      };
      const body = buildRequestBody(config, requestMessages, tools, stream);
      // 调试开关（test.ini）开启时把原始请求落盘；best-effort，不影响主链路
      await dumpChatRequestIfEnabled(retryLabel, url, headers, body);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: deadline.signal,
      });

      if (!response.ok) {
        const message = await parseErrorResponse(response);
        throw new ChatCompletionRequestError(message, response.status >= 500 || isRetryableRequestMessage(message));
      }

      deadline.refresh();
      return { response, deadline };
    } catch (error) {
      deadline.dispose();
      const requestError = toRequestError(error);
      lastError = requestError;
      if (signal.aborted || !requestError.retryable || attempt >= MODEL_REQUEST_RETRY_COUNT) {
        if (!signal.aborted) {
          // 失败后把发出去的消息骨架落盘：能直接区分是我们发的消息配对不上，还是网关转换弄坏了
          await appendMainLog(
            'ERROR',
            `${retryLabel} failed: ${requestError.message}\nOutgoing message skeleton:\n${summarizeMessagesForDiagnostics(requestMessages).join('\n')}`,
          );
        }
        throw requestError;
      }
      await appendMainLog('WARN', `${retryLabel} failed, retrying once: ${requestError.message}`);
    }
  }

  throw lastError ?? new ChatCompletionRequestError('模型服务请求失败。', false);
}

export async function createChatCompletionStream(options: {
  config: AppConfig;
  messages: ChatCompletionApiMessage[];
  tools: ChatCompletionTool[];
  signal: AbortSignal;
  onChunk: (event: ChatCompletionStreamEvent) => void;
}) {
  const { config, messages, tools, signal, onChunk } = options;

  if (!config.deepseekApiKey) {
    throw new Error('请先在设置中配置 API Key。');
  }

  let response: Response;
  let deadline: IdleDeadline;
  try {
    ({ response, deadline } = await requestChatCompletion({
      config,
      messages,
      tools,
      stream: true,
      signal,
      retryLabel: 'Stream chat completion request',
    }));
  } catch (error) {
    const requestError = toRequestError(error);
    if (config.oneApiCompatibilityEnabled && tools.length > 0 && requestError.retryable) {
      await appendMainLog('WARN', `Stream tool request failed; falling back to non-stream chat completion: ${requestError.message}`);
      return createChatCompletion({ config, messages, tools, signal });
    }
    throw requestError;
  }

  try {
    if (!response.body) {
      throw new Error('模型服务未返回可读取的流。');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoningContent = '';
    let toolCalls: ToolCall[] = [];

    const processFrame = (frame: string) => {
      for (const line of frame.split('\n')) {
        const normalized = line.trim();
        if (!normalized.startsWith('data:')) {
          continue;
        }

        const raw = normalized.slice(5).trim();
        if (!raw || raw === '[DONE]') {
          continue;
        }

        const chunk = JSON.parse(raw) as ChatCompletionStreamChunk;
        if (chunk.error?.message) {
          throw new Error(chunk.error.message);
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          continue;
        }

        const nextEvent: ChatCompletionStreamEvent = {};

        if (delta.reasoning_content) {
          reasoningContent += delta.reasoning_content;
          nextEvent.deltaReasoningContent = delta.reasoning_content;
        }

        if (delta.content) {
          content += delta.content;
          nextEvent.deltaContent = delta.content;
        }

        if (nextEvent.deltaReasoningContent || nextEvent.deltaContent) {
          onChunk(nextEvent);
        }

        if (delta.tool_calls?.length) {
          toolCalls = mergeToolCallDelta(toolCalls, delta.tool_calls);
        }
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      // 只要还在出数据就不算超时；否则长响应会在整体预算耗尽时被中途掐断
      deadline.refresh();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        processFrame(frame);
      }

      if (done) {
        break;
      }
    }

    if (buffer.trim()) {
      processFrame(buffer);
    }

    const { valid: validToolCalls, droppedReasons } = filterValidToolCalls(toolCalls);
    if (config.oneApiCompatibilityEnabled && hasOnlyInvalidToolCalls(toolCalls, validToolCalls)) {
      await appendMainLog('INFO', 'Retrying chat completion without stream because streamed tool calls were incomplete.');
      return createChatCompletion({ config, messages, tools, signal });
    }

    for (const reason of droppedReasons) {
      await appendMainLog('ERROR', `Ignored invalid streamed tool call: ${reason}`);
    }

    await appendMainLog('INFO', `Model stream finished contentLength=${content.length} reasoningLength=${reasoningContent.length} toolCalls=${validToolCalls.length}`);

    return {
      role: 'assistant' as const,
      content: content || null,
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      ...(validToolCalls.length > 0 ? { tool_calls: validToolCalls } : {}),
    };
  } catch (error) {
    // 读流阶段的中断原来会以原始 DOMException 冒到顶层（"The operation was aborted due to timeout"），
    // 这里统一转成带上下文的错误信息。
    const requestError = toRequestError(error);
    await appendMainLog('ERROR', `Stream chat completion failed while reading response: ${requestError.message}`);
    throw requestError;
  } finally {
    deadline.dispose();
  }
}

export async function createChatCompletion(options: {
  config: AppConfig;
  messages: ChatCompletionApiMessage[];
  tools: ChatCompletionTool[];
  signal: AbortSignal;
}) {
  const { config, messages, tools, signal } = options;

  if (!config.deepseekApiKey) {
    throw new Error('请先在设置中配置 API Key。');
  }

  /**
   * 网关在大参数（如整文件写入）下会把 tool_call 的 arguments 弄成非法 JSON。
   * 全部调用损坏且没有任何文本时，换一次采样重试；仍损坏则抛出可行动的错误，
   * 而不是静默返回空回复让任务无疾而终。
   */
  const maxCompletionAttempts = 2;
  let lastDroppedReasons: string[] = [];

  for (let attempt = 1; attempt <= maxCompletionAttempts; attempt += 1) {
    const { response, deadline } = await requestChatCompletion({
      config,
      messages,
      tools,
      stream: false,
      signal,
      retryLabel: 'Non-stream chat completion request',
    });

    try {
      if (!response.ok) {
        throw new Error(await parseErrorResponse(response));
      }

      const payload = (await response.json()) as ChatCompletionResponse;

      const message = payload.choices?.[0]?.message;

      if (!message) {
        throw new Error('模型服务未返回有效消息。');
      }

      const { valid: validToolCalls, droppedReasons } = filterValidToolCalls(message.tool_calls ?? []);
      for (const reason of droppedReasons) {
        await appendMainLog('ERROR', `Ignored invalid non-stream tool call (attempt ${attempt}/${maxCompletionAttempts}): ${reason}`);
      }

      const buildResult = () => ({
        role: 'assistant' as const,
        content: message.content ?? null,
        ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
        ...(validToolCalls.length > 0 ? { tool_calls: validToolCalls } : {}),
      });

      // 有可执行调用或有文本：坏调用记日志后按现状返回，不因个别损坏丢弃整轮
      if (validToolCalls.length > 0 || (message.content ?? '').trim().length > 0) {
        return buildResult();
      }

      // 只剩损坏的调用：记录参数开头便于诊断，然后重试
      lastDroppedReasons = droppedReasons;
      const invalidArgsHead = (message.tool_calls ?? [])
        .map((toolCall) => toolCall.function?.arguments ?? '')
        .find((args) => args.trim().length > 0) ?? '';
      if (invalidArgsHead) {
        await appendMainLog('ERROR', `Invalid tool call args head: ${clipLogText(invalidArgsHead.slice(0, 200), 200)}`);
      }

      if (attempt < maxCompletionAttempts) {
        await appendMainLog('WARN', `All tool calls in non-stream response were invalid, retrying completion (attempt ${attempt + 1}/${maxCompletionAttempts}).`);
        continue;
      }
    } catch (error) {
      throw toRequestError(error);
    } finally {
      deadline.dispose();
    }
  }

  throw new ChatCompletionRequestError(
    `模型返回的工具调用参数损坏且重试仍失败（${lastDroppedReasons[0] ?? '未知原因'}）。大参数下模型网关更容易出现该问题；请重试，或在提示词中要求模型把大文件拆成多次较小的写入。`,
    false,
  );
}
