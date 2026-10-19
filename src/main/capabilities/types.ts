import type { AppConfig } from '../../shared/config';
import type { ToolDefinition } from '../../shared/tools';

/**
 * 内部能力模块（capability module）：把一组属于同一功能域的能力（IPC 服务初始化 + 工具）
 * 作为整体插进 core，而不是让 index.ts / tool-registry.ts 为每个功能域硬编码一段。
 *
 * 这是编译期注册契约，不是运行时动态加载——模块仍随 esbuild 一起打进产物。
 * 价值在于：① core 不再硬认识具体功能域；② 能力可按 config 开关整组启停（省模型上下文）。
 *
 * 作用范围仅限主进程 + 工具层。preload / contracts / renderer 的 IPC 边界保持静态声明，
 * 不纳入本契约（那条最小化安全边界不做动态化）。
 */
export type CapabilityModule = {
  /** 模块唯一标识，用于日志与诊断。 */
  id: string;
  /**
   * 该能力当前是否启用。关闭时 getTools() 的结果不会进入模型工具集；
   * initialize() 仍会执行（账户/配置管理等 IPC 不受能力开关影响）。
   */
  isEnabled: (config: AppConfig) => boolean;
  /**
   * 启动时初始化：注册该域的 IPC handler、加载持久化状态等。
   * 在 app ready、各核心 service 装载后调用一次。
   */
  initialize?: () => void | Promise<void>;
  /** 该模块贡献的工具定义；由 isEnabled 门控是否注入运行时工具集。 */
  getTools?: () => ToolDefinition<unknown>[];
};
