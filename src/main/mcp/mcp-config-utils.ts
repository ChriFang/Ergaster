import type {
  McpAgentBinding,
  McpConfig,
  McpServerConfig,
  McpServerListItem,
  McpTransportType,
  SaveMcpServerRequest,
} from '../../shared/mcp';

export function normalizeStringArray(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeStringRecord(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input)
      .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
      .map(([key, value]) => [key.trim(), value])
      .filter(([key]) => key.length > 0),
  );
}

export function normalizeEnv(input: unknown) {
  return normalizeStringRecord(input);
}

export function normalizeHeaders(input: unknown) {
  return normalizeStringRecord(input);
}

export function normalizeMcpEndpointUrl(input: unknown) {
  if (typeof input !== 'string') {
    return null;
  }

  const raw = input.trim();
  if (!raw) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  return raw;
}

export function normalizeTransport(input: unknown): McpTransportType {
  return input === 'streamable-http' ? 'streamable-http' : 'stdio';
}

export function normalizeServerConfig(input: unknown): McpServerConfig | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const server = input as Record<string, unknown>;
  const disabled = Boolean(server.disabled);

  if (normalizeTransport(server.transport) === 'streamable-http') {
    const url = normalizeMcpEndpointUrl(server.url);
    if (!url) {
      return null;
    }

    return {
      transport: 'streamable-http',
      url,
      headers: normalizeHeaders(server.headers),
      disabled,
    };
  }

  const command = typeof server.command === 'string' ? server.command.trim() : '';
  if (!command) {
    return null;
  }

  return {
    transport: 'stdio',
    command,
    args: normalizeStringArray(server.args),
    env: normalizeEnv(server.env),
    disabled,
  };
}

export function sanitizeMcpBinding(input: Partial<McpAgentBinding> | null | undefined): McpAgentBinding {
  return {
    enabledServerNames: normalizeStringArray(input?.enabledServerNames),
  };
}

export function sanitizeMcpConfig(input: Partial<McpConfig> | null | undefined): McpConfig {
  const rawServers = input?.mcpServers;
  const mcpServers = !rawServers || typeof rawServers !== 'object' || Array.isArray(rawServers)
    ? {}
    : Object.fromEntries(
      Object.entries(rawServers)
        .map(([name, value]) => [name.trim(), normalizeServerConfig(value)] as const)
        .filter((entry): entry is [string, McpServerConfig] => Boolean(entry[0]) && Boolean(entry[1])),
    );

  const defaultAgent = sanitizeMcpBinding(input?.defaultAgent);
  defaultAgent.enabledServerNames = defaultAgent.enabledServerNames.filter((name) => Boolean(mcpServers[name]));

  return {
    mcpServers,
    defaultAgent,
  };
}

// 列表用于渲染层展示，HTTP 服务只返回请求头名称，避免把 token 等凭据传出主进程。
export function toMcpServerListItem(name: string, server: McpServerConfig): McpServerListItem {
  if (server.transport === 'streamable-http') {
    return {
      name,
      transport: 'streamable-http',
      command: '',
      args: [],
      env: {},
      url: server.url,
      headerKeys: Object.keys(server.headers ?? {}),
      disabled: Boolean(server.disabled),
    };
  }

  return {
    name,
    transport: 'stdio',
    command: server.command,
    args: server.args ?? [],
    env: server.env ?? {},
    url: '',
    headerKeys: [],
    disabled: Boolean(server.disabled),
  };
}

export function normalizeSaveRequest(request: SaveMcpServerRequest) {
  const originalName = request.originalName?.trim() || undefined;
  const name = request.name.trim();

  if (!name) {
    throw new Error('MCP 名称不能为空。');
  }

  if (normalizeTransport(request.transport) === 'streamable-http') {
    const rawUrl = typeof request.url === 'string' ? request.url.trim() : '';
    if (!rawUrl) {
      throw new Error('服务地址不能为空。');
    }

    const url = normalizeMcpEndpointUrl(rawUrl);
    if (!url) {
      throw new Error('服务地址必须是 http 或 https 链接。');
    }

    return {
      originalName,
      name,
      server: {
        transport: 'streamable-http',
        url,
        headers: normalizeHeaders(request.headers),
        disabled: Boolean(request.disabled),
      } satisfies McpServerConfig,
    };
  }

  const command = typeof request.command === 'string' ? request.command.trim() : '';
  if (!command) {
    throw new Error('命令不能为空。');
  }

  return {
    originalName,
    name,
    server: {
      transport: 'stdio',
      command,
      args: normalizeStringArray(request.args),
      env: normalizeEnv(request.env),
      disabled: Boolean(request.disabled),
    } satisfies McpServerConfig,
  };
}

// 连接缓存的失效判定：任一传输相关字段变化都必须重建连接。
export function buildMcpConfigHash(server: McpServerConfig) {
  if (server.transport === 'streamable-http') {
    return JSON.stringify({
      transport: 'streamable-http',
      url: server.url,
      headers: server.headers ?? {},
      disabled: Boolean(server.disabled),
    });
  }

  return JSON.stringify({
    transport: 'stdio',
    command: server.command,
    args: server.args ?? [],
    env: server.env ?? {},
    disabled: Boolean(server.disabled),
  });
}
