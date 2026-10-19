import type { LucideIcon } from 'lucide-react';
import { Bot, ChevronDown, Info, PlugZap, Plus, Puzzle, Settings2, SlidersHorizontal, Trash2, Workflow, Wrench, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { SettingsDialogTab } from '../../lib/types/app-shell';
import { parseExtensionTab } from '../../lib/types/app-shell';
import { EXTENSION_CATALOG, findExtensionCatalogItem } from '../settings/extensions/extension-catalog';

type SettingsDialogShellProps = {
  open: boolean;
  activeTab: SettingsDialogTab;
  /** 已添加的扩展 id，用于渲染「扩展能力」分组下的子项。 */
  enabledExtensions: string[];
  onClose: () => void;
  onTabChange: (tab: SettingsDialogTab) => void;
  /** 删除某个已添加扩展（从左侧列表移除）。 */
  onRemoveExtension: (id: string) => void;
  renderContent: (tab: SettingsDialogTab) => ReactNode;
};

type TabItem = {
  id: SettingsDialogTab;
  label: string;
  icon: LucideIcon;
};

// 「扩展能力」是可展开分组，单独渲染在「关于」之前，故「关于」也从这张扁平表拆出单独渲染。
const TAB_ITEMS: TabItem[] = [
  { id: 'workflow', label: 'WorkFlow', icon: Workflow },
  { id: 'agents', label: '智能体管理', icon: Bot },
  { id: 'mcp', label: 'MCP 服务', icon: PlugZap },
  { id: 'skills', label: 'Skills 管理', icon: Wrench },
  { id: 'tools', label: '工具设置', icon: Settings2 },
  { id: 'general', label: '通用设置', icon: SlidersHorizontal },
];

const ABOUT_TAB: TabItem = { id: 'about', label: '关于', icon: Info };

export function SettingsDialogShell({
  open,
  activeTab,
  enabledExtensions,
  onClose,
  onTabChange,
  onRemoveExtension,
  renderContent,
}: SettingsDialogShellProps) {
  if (!open) {
    return null;
  }

  // 分组始终展开展示：选中扩展目录或任一扩展子项时高亮分组头。
  const activeExtensionId = parseExtensionTab(activeTab);
  const isExtensionsActive = activeTab === 'extensions';
  // 只渲染「已添加且在目录中有定义」的子项，顺序按目录顺序稳定
  const addedItems = EXTENSION_CATALOG.filter((item) => enabledExtensions.includes(item.id));
  const isExtensionsContext = isExtensionsActive || activeExtensionId !== null;

  // 列表默认收起；点分组头切换。当选中态落在扩展相关页时自动展开，避免"选中了却看不见子项"。
  const [extensionsExpanded, setExtensionsExpanded] = useState(isExtensionsContext);
  useEffect(() => {
    if (isExtensionsContext) {
      setExtensionsExpanded(true);
    }
  }, [isExtensionsContext]);

  return (
    <div className="settings-dialog-overlay" onClick={onClose}>
      <div className="settings-dialog-shell" onClick={(event) => event.stopPropagation()}>
        <button className="settings-dialog-close-button" type="button" onClick={onClose} aria-label="关闭设置">
          <X size={16} strokeWidth={2.2} />
        </button>

        <nav className="settings-dialog-nav" aria-label="设置导航">
          <div className="settings-dialog-nav-header">
            <h3>设置</h3>
          </div>
          <div className="settings-dialog-nav-list">
            {TAB_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-dialog-nav-item${isActive ? ' settings-dialog-nav-item-active' : ''}`}
                  onClick={() => onTabChange(item.id)}
                >
                  <Icon size={16} strokeWidth={2} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}

            <div className="settings-dialog-nav-group">
              <button
                type="button"
                className={`settings-dialog-nav-item${isExtensionsContext ? ' settings-dialog-nav-item-active' : ''}`}
                aria-expanded={extensionsExpanded}
                onClick={() => setExtensionsExpanded((value) => !value)}
              >
                <Puzzle size={16} strokeWidth={2} aria-hidden="true" />
                <span>扩展能力</span>
                <ChevronDown
                  className={`settings-dialog-nav-chevron${extensionsExpanded ? ' settings-dialog-nav-chevron-expanded' : ''}`}
                  size={14}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </button>

              {extensionsExpanded ? (
                <div className="settings-dialog-nav-sublist">
                  {addedItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeExtensionId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`settings-dialog-nav-subitem${isActive ? ' settings-dialog-nav-subitem-active' : ''}`}
                      >
                        <button
                          type="button"
                          className="settings-dialog-nav-subitem-main"
                          onClick={() => onTabChange(`extension:${item.id}`)}
                        >
                          <Icon size={14} strokeWidth={2} aria-hidden="true" />
                          <span>{item.label}</span>
                        </button>
                        <button
                          type="button"
                          className="settings-dialog-nav-subitem-remove"
                          aria-label={`移除扩展：${item.label}`}
                          title="从扩展能力中移除（不会删除已保存的配置）"
                          onClick={() => onRemoveExtension(item.id)}
                        >
                          <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    className={`settings-dialog-nav-subitem-add${isExtensionsActive ? ' settings-dialog-nav-subitem-add-active' : ''}`}
                    onClick={() => onTabChange('extensions')}
                  >
                    <Plus size={14} strokeWidth={2} aria-hidden="true" />
                    <span>添加</span>
                  </button>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className={`settings-dialog-nav-item${activeTab === ABOUT_TAB.id ? ' settings-dialog-nav-item-active' : ''}`}
              onClick={() => onTabChange(ABOUT_TAB.id)}
            >
              <ABOUT_TAB.icon size={16} strokeWidth={2} aria-hidden="true" />
              <span>{ABOUT_TAB.label}</span>
            </button>
          </div>
        </nav>

        <section className="settings-dialog-content">
          <div className="settings-dialog-content-scroll">{renderContent(activeTab)}</div>
        </section>
      </div>
    </div>
  );
}

/** 供外部复用：某扩展 id 是否在目录里有可渲染的设置面板。 */
export function hasExtensionPanel(id: string) {
  return Boolean(findExtensionCatalogItem(id));
}
