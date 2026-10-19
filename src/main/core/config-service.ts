import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppConfig, configFileName, defaultConfig, normalizeDownloadHost, sanitizeConfig, toMaskedConfig } from '../../shared/config';

const configDirectory = app.getPath('userData');
const configPath = path.join(configDirectory, configFileName);

async function ensureDirectory() {
  await fs.mkdir(configDirectory, { recursive: true });
}

export async function loadConfig(): Promise<AppConfig> {
  await ensureDirectory();

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return sanitizeConfig(JSON.parse(raw) as Partial<AppConfig>);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code !== 'ENOENT') {
      console.warn('[config] Failed to read config file, using defaults.');
    }

    return defaultConfig;
  }
}

export async function getMaskedConfig() {
  const config = await loadConfig();
  return toMaskedConfig(config);
}

export async function saveConfig(input: Partial<AppConfig>) {
  const merged = sanitizeConfig({ ...(await loadConfig()), ...input });

  await ensureDirectory();
  await fs.writeFile(configPath, JSON.stringify(merged, null, 2), 'utf8');

  return toMaskedConfig(merged);
}

export function getConfigPath() {
  return configPath;
}

/** 确认卡「总是允许此命令」：把命令前缀并入全局白名单并持久化（sanitize 链路负责去重与小写化）。 */
export async function appendCommandAllowlist(prefix: string) {
  const normalized = prefix.trim().toLowerCase();
  if (!normalized) {
    return;
  }

  const current = await loadConfig();
  const existing = current.toolSettings?.commandAllowlist ?? [];
  if (existing.includes(normalized)) {
    return;
  }

  await saveConfig({
    toolSettings: {
      ...current.toolSettings,
      commandAllowlist: [...existing, normalized],
    },
  });
}

/** 确认卡「自动运行并记住（全局）」：把工具名并入全局自动执行清单并持久化。 */
export async function appendAutoExecuteTool(toolName: string) {
  const normalized = toolName.trim();
  if (!normalized) {
    return;
  }

  const current = await loadConfig();
  const existing = current.toolSettings?.autoExecuteTools ?? [];
  if (existing.includes(normalized)) {
    return;
  }

  await saveConfig({
    toolSettings: {
      ...current.toolSettings,
      autoExecuteTools: [...existing, normalized],
    },
  });
}

/** 确认卡「总是允许此域名」：把主机名并入下载域名白名单并持久化（非法主机名忽略）。 */
export async function appendDownloadAllowedHost(host: string) {
  const normalized = normalizeDownloadHost(host);
  if (!normalized) {
    return;
  }

  const current = await loadConfig();
  const existing = current.toolSettings?.downloadAllowedHosts ?? [];
  if (existing.includes(normalized)) {
    return;
  }

  await saveConfig({
    toolSettings: {
      ...current.toolSettings,
      downloadAllowedHosts: [...existing, normalized],
    },
  });
}

/**
 * 解析用于 GitHub API 请求的 token：优先取应用配置里的 githubToken，
 * 未配置时回退到 GITHUB_TOKEN 环境变量；都没有则返回空串（保持匿名请求）。
 */
export async function getGithubToken(): Promise<string> {
  const fromConfig = (await loadConfig()).githubToken.trim();
  if (fromConfig) {
    return fromConfig;
  }
  return process.env.GITHUB_TOKEN?.trim() ?? '';
}
