import type { LucideIcon } from 'lucide-react';
import { Mail } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ExtensionId } from '../../../../shared/extensions';
import { MailAccountsPanel } from '../MailAccountsPanel';

/**
 * 扩展能力目录（renderer 侧）：描述每个扩展在设置界面如何展示与配置。
 * id 取自 shared/extensions 的 EXTENSION_IDS，与 main 的 capabilityModules 一一对应。
 * 新增扩展：在 EXTENSION_IDS 登记 id → main 注册 CapabilityModule → 此处补一条目录项。
 */
export type ExtensionCatalogItem = {
  id: ExtensionId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** 该扩展的设置面板；点击已添加子项时渲染。统一只需要 onClose。 */
  Panel: ComponentType<{ onClose: () => void }>;
};

export const EXTENSION_CATALOG: ExtensionCatalogItem[] = [
  {
    id: 'mail',
    label: '邮箱账户',
    description: '让模型能读取、搜索、标记已配置邮箱的邮件。',
    icon: Mail,
    Panel: MailAccountsPanel,
  },
];

export function findExtensionCatalogItem(id: string): ExtensionCatalogItem | undefined {
  return EXTENSION_CATALOG.find((item) => item.id === id);
}
