import fs from 'node:fs/promises';
import path from 'node:path';
import type { McpAgentBinding, McpConfig, McpServerListItem, SaveMcpServerRequest } from '../../shared/mcp';
import { appendMainLog } from '../core/audit-log';
import { getAppDataRoot } from '../core/app-paths';
import {
  normalizeSaveRequest,
  sanitizeMcpBinding,
  sanitizeMcpConfig,
  toMcpServerListItem,
} from './mcp-config-utils';

const mcpDirectory = getAppDataRoot();
const mcpConfigPath = path.join(mcpDirectory, 'mcp.json');

async function ensureMcpDirectory() {
  await fs.mkdir(mcpDirectory, { recursive: true });
}

export async function loadMcpConfig(): Promise<McpConfig> {
  await ensureMcpDirectory();

  try {
    const raw = await fs.readFile(mcpConfigPath, 'utf8');
    return sanitizeMcpConfig(JSON.parse(raw) as Partial<McpConfig>);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'ENOENT') {
      await appendMainLog('ERROR', `[mcp] Failed to read MCP config, fallback to defaults: ${nodeError.message}`);
    }
    return {
      mcpServers: {},
      defaultAgent: { enabledServerNames: [] },
    };
  }
}

export async function saveMcpConfig(input: Partial<McpConfig>) {
  const merged = sanitizeMcpConfig({ ...(await loadMcpConfig()), ...input });
  await ensureMcpDirectory();
  await fs.writeFile(mcpConfigPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}

/** 确保 mcp.json 存在（缺失则写入空配置），返回其绝对路径。供“打开 MCP 文件”按钮使用。 */
export async function ensureMcpConfigFile(): Promise<string> {
  await ensureMcpDirectory();
  try {
    await fs.access(mcpConfigPath);
  } catch {
    const defaults = sanitizeMcpConfig({});
    await fs.writeFile(mcpConfigPath, `${JSON.stringify(defaults, null, 2)}\n`, 'utf8');
  }
  return mcpConfigPath;
}

export async function listMcpServers(): Promise<McpServerListItem[]> {
  const config = await loadMcpConfig();
  return Object.entries(config.mcpServers)
    .map(([name, server]) => toMcpServerListItem(name, server))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

export async function saveMcpServer(request: SaveMcpServerRequest) {
  const normalized = normalizeSaveRequest(request);
  const current = await loadMcpConfig();
  const mcpServers = { ...current.mcpServers };
  const originalName = normalized.originalName;
  const hasOriginal = originalName ? Boolean(mcpServers[originalName]) : false;

  if (originalName && !hasOriginal) {
    throw new Error(`未找到 MCP 服务：${originalName}`);
  }

  if ((!originalName || originalName !== normalized.name) && mcpServers[normalized.name]) {
    throw new Error(`MCP 服务“${normalized.name}”已存在。`);
  }

  if (originalName && originalName !== normalized.name) {
    delete mcpServers[originalName];
  }

  mcpServers[normalized.name] = normalized.server;

  const defaultAgent = {
    enabledServerNames: current.defaultAgent.enabledServerNames.map((serverName) => (
      originalName && serverName === originalName ? normalized.name : serverName
    )),
  };

  return saveMcpConfig({
    ...current,
    mcpServers,
    defaultAgent,
  });
}

export async function deleteMcpServer(name: string) {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error('MCP 名称不能为空。');
  }

  const current = await loadMcpConfig();
  if (!current.mcpServers[normalizedName]) {
    throw new Error(`未找到 MCP 服务：${normalizedName}`);
  }

  const nextServers = { ...current.mcpServers };
  delete nextServers[normalizedName];

  const nextDefaultAgent = {
    enabledServerNames: current.defaultAgent.enabledServerNames.filter((serverName) => serverName !== normalizedName),
  };

  return saveMcpConfig({
    mcpServers: nextServers,
    defaultAgent: nextDefaultAgent,
  });
}

export async function saveDefaultAgentMcpBinding(binding: McpAgentBinding) {
  const current = await loadMcpConfig();
  const nextBinding = sanitizeMcpBinding(binding);
  nextBinding.enabledServerNames = nextBinding.enabledServerNames.filter((name) => Boolean(current.mcpServers[name]));
  return saveMcpConfig({
    ...current,
    defaultAgent: nextBinding,
  });
}

export function getMcpConfigPath() {
  return mcpConfigPath;
}
