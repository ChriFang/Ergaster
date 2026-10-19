import type { AppConfig } from '../../shared/config';
import type { ToolDefinition } from '../../shared/tools';
import type { CapabilityModule } from './types';

/**
 * 能力模块的纯组合逻辑，与具体模块清单解耦，便于单测（capability-registry 本身因邮件模块
 * 间接依赖 electron，不能被 node --test 直接导入）。
 */

/** 收集启用模块贡献的工具（isEnabled=true 才计入）。 */
export function selectEnabledTools(
  modules: readonly CapabilityModule[],
  config: AppConfig,
): ToolDefinition<unknown>[] {
  const tools: ToolDefinition<unknown>[] = [];
  for (const module of modules) {
    if (module.getTools && module.isEnabled(config)) {
      tools.push(...module.getTools());
    }
  }
  return tools;
}

/** 收集全部模块贡献的工具（忽略开关），供需要静态全集的场景使用。 */
export function collectAllTools(modules: readonly CapabilityModule[]): ToolDefinition<unknown>[] {
  const tools: ToolDefinition<unknown>[] = [];
  for (const module of modules) {
    if (module.getTools) {
      tools.push(...module.getTools());
    }
  }
  return tools;
}
