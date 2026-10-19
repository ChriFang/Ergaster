export type McpAgentBinding = {
  enabledServerNames: string[];
};

export type McpTransportType = 'stdio' | 'streamable-http';

export type McpStdioServerConfig = {
  transport?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
};

export type McpHttpServerConfig = {
  transport: 'streamable-http';
  url: string;
  headers?: Record<string, string>;
  disabled?: boolean;
};

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export type McpConfig = {
  mcpServers: Record<string, McpServerConfig>;
  defaultAgent: McpAgentBinding;
};

export type McpServerListItem = {
  name: string;
  transport: McpTransportType;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headerKeys: string[];
  disabled: boolean;
};

export type SaveMcpServerRequest = {
  originalName?: string;
  name: string;
  transport: McpTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  disabled: boolean;
};

export type McpOperationResult = {
  ok: boolean;
  error?: string;
  data?: unknown;
};
