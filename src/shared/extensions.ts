/**
 * 内部扩展能力（extension capability）的 id 单一事实源。
 *
 * main 的 capabilityModules 与 renderer 的扩展目录（extension-catalog）都从这里取 id，
 * 避免两端字符串漂移导致「添加了但工具没进 / 有工具但列表里没有」。
 * 新增一个扩展：先在此登记 id，再在 main 注册 CapabilityModule、在 renderer 登记目录项。
 */
export const EXTENSION_IDS = ['mail'] as const;

export type ExtensionId = (typeof EXTENSION_IDS)[number];

export function isExtensionId(value: string): value is ExtensionId {
  return (EXTENSION_IDS as readonly string[]).includes(value);
}
