import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMcpConfigHash,
  normalizeHeaders,
  normalizeMcpEndpointUrl,
  normalizeSaveRequest,
  sanitizeMcpConfig,
  toMcpServerListItem,
} from './mcp-config-utils';

test('历史 stdio 配置（无 transport 字段）仍按 stdio 解析', () => {
  const config = sanitizeMcpConfig({
    mcpServers: {
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: { NODE_ENV: 'production' },
      },
    } as never,
    defaultAgent: { enabledServerNames: ['filesystem'] },
  });

  const server = config.mcpServers.filesystem;
  assert.equal(server.transport, 'stdio');
  assert.deepEqual(server, {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    env: { NODE_ENV: 'production' },
    disabled: false,
  });
  assert.deepEqual(config.defaultAgent.enabledServerNames, ['filesystem']);
});

test('streamable-http 配置保留 url 与 headers', () => {
  const config = sanitizeMcpConfig({
    mcpServers: {
      remote: {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer secret-token', 'X-Empty': 1 },
        disabled: true,
      },
    } as never,
    defaultAgent: { enabledServerNames: ['remote'] },
  });

  assert.deepEqual(config.mcpServers.remote, {
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer secret-token' },
    disabled: true,
  });
});

test('非法服务配置被丢弃', () => {
  const config = sanitizeMcpConfig({
    mcpServers: {
      'missing-url': { transport: 'streamable-http' },
      'bad-scheme': { transport: 'streamable-http', url: 'ftp://example.com/mcp' },
      'non-string-url': { transport: 'streamable-http', url: 42 },
      'not-a-url': { transport: 'streamable-http', url: 'example.com/mcp' },
      'missing-command': { transport: 'stdio', args: ['--flag'] },
      'blank-command': { command: '   ' },
    } as never,
    defaultAgent: { enabledServerNames: ['missing-url', 'bad-scheme'] },
  });

  assert.deepEqual(config.mcpServers, {});
  assert.deepEqual(config.defaultAgent.enabledServerNames, []);
});

test('normalizeMcpEndpointUrl 只接受 http/https', () => {
  assert.equal(normalizeMcpEndpointUrl(' https://example.com/mcp '), 'https://example.com/mcp');
  assert.equal(normalizeMcpEndpointUrl('http://127.0.0.1:3000/mcp'), 'http://127.0.0.1:3000/mcp');
  assert.equal(normalizeMcpEndpointUrl('ws://example.com/mcp'), null);
  assert.equal(normalizeMcpEndpointUrl('file:///tmp/mcp'), null);
  assert.equal(normalizeMcpEndpointUrl(''), null);
  assert.equal(normalizeMcpEndpointUrl(undefined), null);
});

test('normalizeHeaders 丢弃非字符串项与空键', () => {
  assert.deepEqual(
    normalizeHeaders({ ' Authorization ': 'Bearer x', 'X-Num': 3, '': 'y' }),
    { Authorization: 'Bearer x' },
  );
  assert.deepEqual(normalizeHeaders(['Authorization']), {});
  assert.deepEqual(normalizeHeaders(null), {});
});

test('列表项不返回 HTTP 请求头明文', () => {
  const item = toMcpServerListItem('remote', {
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer secret-token' },
  });

  assert.deepEqual(item.headerKeys, ['Authorization']);
  assert.equal(JSON.stringify(item).includes('secret-token'), false);
  assert.equal(item.command, '');
});

test('normalizeSaveRequest 对 HTTP 请求给出明确校验错误', () => {
  assert.throws(
    () => normalizeSaveRequest({ name: 'remote', transport: 'streamable-http', disabled: false }),
    /服务地址不能为空。/,
  );

  assert.throws(
    () => normalizeSaveRequest({ name: 'remote', transport: 'streamable-http', url: 'ftp://example.com', disabled: false }),
    /服务地址必须是 http 或 https 链接。/,
  );

  assert.throws(
    () => normalizeSaveRequest({ name: 'local', transport: 'stdio', disabled: false }),
    /命令不能为空。/,
  );

  const normalized = normalizeSaveRequest({
    name: ' remote ',
    transport: 'streamable-http',
    url: ' https://example.com/mcp ',
    headers: { Authorization: 'Bearer x' },
    command: 'npx',
    args: ['ignored'],
    disabled: false,
  });

  assert.equal(normalized.name, 'remote');
  assert.deepEqual(normalized.server, {
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer x' },
    disabled: false,
  });
});

test('buildMcpConfigHash 对传输相关字段变化敏感', () => {
  const base = buildMcpConfigHash({ transport: 'streamable-http', url: 'https://a/mcp', headers: { A: '1' } });

  assert.notEqual(base, buildMcpConfigHash({ transport: 'streamable-http', url: 'https://b/mcp', headers: { A: '1' } }));
  assert.notEqual(base, buildMcpConfigHash({ transport: 'streamable-http', url: 'https://a/mcp', headers: { A: '2' } }));
  assert.notEqual(base, buildMcpConfigHash({ transport: 'streamable-http', url: 'https://a/mcp', headers: { A: '1' }, disabled: true }));
  assert.notEqual(base, buildMcpConfigHash({ transport: 'stdio', command: 'npx' }));
  assert.equal(base, buildMcpConfigHash({ transport: 'streamable-http', url: 'https://a/mcp', headers: { A: '1' }, disabled: false }));

  const stdio = buildMcpConfigHash({ transport: 'stdio', command: 'npx', args: ['a'], env: { E: '1' } });
  assert.notEqual(stdio, buildMcpConfigHash({ transport: 'stdio', command: 'npx', args: ['b'], env: { E: '1' } }));
  assert.notEqual(stdio, buildMcpConfigHash({ transport: 'stdio', command: 'npx', args: ['a'], env: { E: '2' } }));
});
