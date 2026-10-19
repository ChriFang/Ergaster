import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from '../../shared/mcp';
import { normalizeMcpEndpointUrl } from './mcp-config-utils';

// 日志与错误信息只允许出现服务地址的非敏感摘要，绝不能带上 headers、query 中的凭据。
export function describeMcpTarget(server: McpServerConfig) {
  if (server.transport === 'streamable-http') {
    const url = normalizeMcpEndpointUrl(server.url);
    if (!url) {
      return 'streamable-http (invalid url)';
    }

    const parsed = new URL(url);
    return `streamable-http ${parsed.origin}${parsed.pathname}`;
  }

  return `stdio ${server.command}`;
}

export function createMcpTransport(server: McpServerConfig): Transport {
  if (server.transport === 'streamable-http') {
    const url = normalizeMcpEndpointUrl(server.url);
    if (!url) {
      throw new Error('MCP 服务地址无效，必须是 http 或 https 链接。');
    }

    return new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers: server.headers ?? {},
      },
    });
  }

  return new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: server.env,
  });
}

function extractHttpStatus(error: unknown) {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' ? code : undefined;
}

// 把 SDK/网络层异常翻译成可展示的中文原因，同时保证不回显请求头。
export function describeMcpConnectionError(error: unknown, server: McpServerConfig) {
  const rawMessage = error instanceof Error ? error.message : 'unknown error';
  if (server.transport !== 'streamable-http') {
    return rawMessage;
  }

  const status = extractHttpStatus(error);
  if (status === 401 || status === 403) {
    return `HTTP ${status}：MCP 服务鉴权失败，请检查请求头中的访问凭据。`;
  }
  if (status === 404 || status === 405) {
    return `HTTP ${status}：该地址不是可用的 Streamable HTTP MCP 端点。`;
  }
  if (status === 429) {
    return 'HTTP 429：MCP 服务限流，请稍后重试。';
  }
  if (typeof status === 'number' && status >= 500) {
    return `HTTP ${status}：MCP 服务内部错误。`;
  }

  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timeout/i.test(rawMessage)) {
    return `无法连接 MCP 服务（${describeMcpTarget(server)}）：${rawMessage}`;
  }

  return rawMessage;
}
