import assert from 'node:assert/strict';
import test from 'node:test';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpTransport, describeMcpConnectionError, describeMcpTarget } from './mcp-transport';

test('stdio 配置创建 StdioClientTransport', () => {
  const transport = createMcpTransport({ transport: 'stdio', command: 'node', args: ['--version'] });
  assert.equal(transport instanceof StdioClientTransport, true);
});

test('streamable-http 配置创建 StreamableHTTPClientTransport', () => {
  const transport = createMcpTransport({
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer secret-token' },
  });

  assert.equal(transport instanceof StreamableHTTPClientTransport, true);
});

test('非法 URL 在创建 transport 时立即抛错', () => {
  assert.throws(
    () => createMcpTransport({ transport: 'streamable-http', url: 'ftp://example.com/mcp' }),
    /MCP 服务地址无效/,
  );

  assert.throws(
    () => createMcpTransport({ transport: 'streamable-http', url: 'not-a-url' }),
    /MCP 服务地址无效/,
  );
});

test('describeMcpTarget 不包含请求头与查询串凭据', () => {
  const summary = describeMcpTarget({
    transport: 'streamable-http',
    url: 'https://example.com/mcp?token=secret-token',
    headers: { Authorization: 'Bearer secret-token' },
  });

  assert.equal(summary, 'streamable-http https://example.com/mcp');
  assert.equal(summary.includes('secret-token'), false);
  assert.equal(describeMcpTarget({ transport: 'stdio', command: 'npx' }), 'stdio npx');
});

test('describeMcpConnectionError 区分鉴权、端点与限流错误', () => {
  const server = { transport: 'streamable-http', url: 'https://example.com/mcp' } as const;

  const unauthorized = Object.assign(new Error('Unauthorized'), { code: 401 });
  assert.match(describeMcpConnectionError(unauthorized, server), /鉴权失败/);

  const notFound = Object.assign(new Error('Not Found'), { code: 404 });
  assert.match(describeMcpConnectionError(notFound, server), /不是可用的 Streamable HTTP MCP 端点/);

  const rateLimited = Object.assign(new Error('Too Many Requests'), { code: 429 });
  assert.match(describeMcpConnectionError(rateLimited, server), /限流/);

  const serverError = Object.assign(new Error('Bad Gateway'), { code: 502 });
  assert.match(describeMcpConnectionError(serverError, server), /HTTP 502/);

  assert.match(describeMcpConnectionError(new Error('fetch failed'), server), /无法连接 MCP 服务/);

  const stdioMessage = describeMcpConnectionError(new Error('spawn npx ENOENT'), { transport: 'stdio', command: 'npx' });
  assert.equal(stdioMessage, 'spawn npx ENOENT');
});
