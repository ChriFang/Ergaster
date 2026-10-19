import type { AppConfig } from '../../shared/config';
import type { CapabilityModule } from '../capabilities/types';
import { mailAccountService } from './mail-account-service';
import { registerMailHandlers } from './mail-handlers';
import { mailToolDefinitions } from './mail-tool-definitions';

/**
 * 邮件内部能力模块：把原先散在 index.ts（初始化 + IPC）与 tool-registry（工具定义）里的
 * 邮件接入点收拢到一处，使 core 不再硬编码邮件。
 *
 * - initialize：注册邮件 IPC + 加载账户（账户管理不随能力开关走，始终可用）。
 * - isEnabled / getTools：email_* 工具按 config.mailEnabled 门控是否进入模型工具集。
 */
export const mailCapability: CapabilityModule = {
  id: 'mail',
  isEnabled: (config: AppConfig) => config.enabledExtensions.includes('mail'),
  initialize: async () => {
    registerMailHandlers();
    await mailAccountService.load();
  },
  getTools: () => mailToolDefinitions,
};
