import { app } from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult as SdkCallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolSchemaShape } from '../../shared/tools';
import type { McpServerConfig } from '../../shared/mcp';
import { appendMainLog } from '../core/audit-log';
import { loadMcpConfig } from './mcp-config-service';
import { buildMcpConfigHash } from './mcp-config-utils';
import { createMcpTransport, describeMcpConnectionError, describeMcpTarget } from './mcp-transport';
import { extractMcpResultContent } from './mcp-result-utils';
import { assessMcpToolRisk } from './mcp-risk';

const emptySchema: ToolSchemaShape = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

type McpListedTool = {
  name: string;
  description: string;
  inputSchema: ToolSchemaShape;
};

type McpServerConnection = {
  serverName: string;
  configHash: string;
  client: Client;
  transport: Transport;
  toolsCache: McpListedTool[];
};

function normalizeSchema(input: unknown): ToolSchemaShape {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return emptySchema;
  }

  const schema = input as Partial<ToolSchemaShape>;
  if (schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    return emptySchema;
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : undefined;

  return {
    type: 'object',
    properties: schema.properties,
    ...(required && required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function buildToolAlias(serverIndex: number, toolIndex: number) {
  return `mcp_${serverIndex}_${toolIndex}`;
}

class McpService {
  private connections = new Map<string, McpServerConnection>();

  private async connectServer(serverName: string, server: McpServerConfig) {
    const configHash = buildMcpConfigHash(server);
    const existing = this.connections.get(serverName);
    if (existing && existing.configHash === configHash) {
      return existing;
    }

    if (existing) {
      await this.closeConnection(serverName);
    }

    const client = new Client(
      {
        name: 'ergaster-mcp-client',
        version: app.getVersion(),
      },
      {
        capabilities: {
          sampling: {},
        },
      },
    );
    const transport = createMcpTransport(server);

    try {
      await client.connect(transport);
    } catch (error) {
      try {
        await client.close();
      } catch {
        // ignore
      }
      throw new Error(describeMcpConnectionError(error, server));
    }

    const toolsResponse = await client.listTools();
    const toolsCache = (toolsResponse.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: normalizeSchema(tool.inputSchema),
    }));

    const connection: McpServerConnection = {
      serverName,
      configHash,
      client,
      transport,
      toolsCache,
    };

    this.connections.set(serverName, connection);
    await appendMainLog(
      'INFO',
      `[mcp] Connected server ${serverName} (${describeMcpTarget(server)}) with ${toolsCache.length} tools`,
    );
    return connection;
  }

  private async closeConnection(serverName: string) {
    const existing = this.connections.get(serverName);
    if (!existing) {
      return;
    }

    this.connections.delete(serverName);
    try {
      await existing.client.close();
    } catch {
      // ignore
    }
  }

  async invalidateServer(serverName: string) {
    await this.closeConnection(serverName);
  }

  async invalidateAllServers() {
    const names = [...this.connections.keys()];
    for (const name of names) {
      await this.closeConnection(name);
    }
  }

  async getEnabledMcpToolDefinitionsForServerNames(serverNames: string[]): Promise<ToolDefinition<unknown>[]> {
    const config = await loadMcpConfig();
    const filteredServerNames = serverNames.filter((serverName) => {
      const server = config.mcpServers[serverName];
      return Boolean(server) && !server.disabled;
    });

    const tools: ToolDefinition<unknown>[] = [];
    for (const [serverIndex, serverName] of filteredServerNames.entries()) {
      const server = config.mcpServers[serverName];
      if (!server) {
        continue;
      }

      try {
        const connection = await this.connectServer(serverName, server);
        for (const [toolIndex, tool] of connection.toolsCache.entries()) {
          tools.push({
            name: buildToolAlias(serverIndex, toolIndex),
            description: tool.description ? `[MCP/${serverName}] ${tool.description}` : `[MCP/${serverName}] ${tool.name}`,
            // MCP 工具的行为由外部服务决定，按名称/描述启发式分级；medium/high 会走用户确认
            risk: assessMcpToolRisk({ toolName: tool.name, description: tool.description }),
            strict: true,
            parameters: tool.inputSchema,
            validator: z.unknown(),
            source: {
              type: 'mcp',
              serverName,
            },
            execute: async (args) => {
              return this.callTool({
                serverName,
                toolName: tool.name,
                args,
              });
            },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        await appendMainLog('ERROR', `[mcp] Failed to load tools from ${serverName}: ${message}`);
      }
    }

    return tools;
  }

  async getEnabledMcpToolDefinitions(): Promise<ToolDefinition<unknown>[]> {
    const config = await loadMcpConfig();
    return this.getEnabledMcpToolDefinitionsForServerNames(config.defaultAgent.enabledServerNames);
  }

  async getToolsForServer(serverName: string): Promise<McpListedTool[]> {
    const config = await loadMcpConfig();
    const server = config.mcpServers[serverName];
    if (!server) {
      throw new Error(`未找到 MCP 服务：${serverName}`);
    }
    const connection = await this.connectServer(serverName, server);
    return connection.toolsCache;
  }

  async callTool(input: { serverName: string; toolName: string; args: unknown }): Promise<ToolResult> {
    const config = await loadMcpConfig();
    const server = config.mcpServers[input.serverName];
    if (!server) {
      throw new Error(`未找到 MCP 服务：${input.serverName}`);
    }
    if (server.disabled) {
      throw new Error(`MCP 服务已关闭：${input.serverName}`);
    }

    const connection = await this.connectServer(input.serverName, server);
    let result;
    try {
      result = await connection.client.callTool({
        name: input.toolName,
        arguments: input.args && typeof input.args === 'object' ? input.args as Record<string, unknown> : {},
      });
    } catch (error) {
      const message = describeMcpConnectionError(error, server);
      await appendMainLog('ERROR', `[mcp] Tool call failed on ${input.serverName}/${input.toolName}: ${message}`);
      throw new Error(message);
    }
    const resultWithContent = result as { content?: SdkCallToolResult['content']; isError?: boolean };
    const { text, images } = extractMcpResultContent(resultWithContent);

    return {
      ok: !resultWithContent.isError,
      content: text,
      ...(images.length > 0 ? { images } : {}),
      data: result,
      ...(resultWithContent.isError ? { error: text } : {}),
    };
  }
}

export const mcpService = new McpService();
