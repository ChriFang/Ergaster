import { Check, Plus } from 'lucide-react';
import { EXTENSION_CATALOG } from './extension-catalog';

type ExtensionsCatalogPanelProps = {
  /** 当前已添加的扩展 id。 */
  enabledExtensions: string[];
  /** 添加某扩展（写入 config.enabledExtensions 并切到其设置页）。 */
  onAdd: (id: string) => void;
};

/**
 * 「扩展能力」页签默认内容 / 点击 + 后的目录视图：列出 app 支持的全部扩展，
 * 已添加的标记为已添加，未添加的给出"添加"入口。
 */
export function ExtensionsCatalogPanel({ enabledExtensions, onAdd }: ExtensionsCatalogPanelProps) {
  const added = new Set(enabledExtensions);

  return (
    <section className="extensions-catalog-panel">
      <header className="extensions-catalog-header">
        <h3>扩展能力</h3>
        <p className="extensions-catalog-subtitle">按需添加扩展能力；添加后会出现在左侧列表中，点击即可进行设置。</p>
      </header>

      <div className="extensions-catalog-list">
        {EXTENSION_CATALOG.map((item) => {
          const Icon = item.icon;
          const isAdded = added.has(item.id);
          return (
            <div key={item.id} className="extensions-catalog-item">
              <div className="extensions-catalog-item-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={2} />
              </div>
              <div className="extensions-catalog-item-main">
                <div className="extensions-catalog-item-label">{item.label}</div>
                <div className="extensions-catalog-item-desc">{item.description}</div>
              </div>
              {isAdded ? (
                <span className="extensions-catalog-item-added">
                  <Check size={14} strokeWidth={2.2} aria-hidden="true" />
                  已添加
                </span>
              ) : (
                <button type="button" className="extensions-catalog-item-add" onClick={() => onAdd(item.id)}>
                  <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
                  添加
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
