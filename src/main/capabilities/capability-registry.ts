import type { AppConfig } from '../../shared/config';
import type { ToolDefinition } from '../../shared/tools';
import { appendMainLog } from '../core/audit-log';
import type { CapabilityModule } from './types';
import { collectAllTools, selectEnabledTools } from './capability-select';
import { mailCapability } from '../mail/mail-capability';

/**
 * 已注册的内部能力模块清单。新增一个功能域时在这里登记一行，
 * core 的初始化与工具组合会自动纳入，不必再在 index.ts / tool-registry 里各加一段。
 */
const capabilityModules: CapabilityModule[] = [mailCapability];

/** 启动时初始化全部能力模块（注册各自 IPC、加载持久化状态）。失败只隔离该模块，不阻断其余。 */
export async function initializeCapabilities(): Promise<void> {
  for (const module of capabilityModules) {
    if (!module.initialize) {
      continue;
    }
    try {
      await module.initialize();
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      await appendMainLog('ERROR', `capability initialize failed: ${module.id}, error: ${message}`);
    }
  }
}

/**
 * 收集当前启用的能力模块贡献的工具。关闭的能力（isEnabled=false）其工具不进入结果，
 * 从而不出现在模型工具集里（省上下文）。
 */
export function getEnabledCapabilityTools(config: AppConfig): ToolDefinition<unknown>[] {
  return selectEnabledTools(capabilityModules, config);
}

/** 全部能力模块贡献的工具（忽略开关）：供工具目录 / 基础工具名等需要静态全集的场景使用。 */
export function getAllCapabilityTools(): ToolDefinition<unknown>[] {
  return collectAllTools(capabilityModules);
}

