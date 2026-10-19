import { Check, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppConfig } from '../../../shared/config';
import { maxToolRounds, minToolRounds } from '../../../shared/config';
import type { SystemToolCatalogItem } from '../../../shared/tools';
import { downloadToolName } from '../../../shared/tools';
import { BUILTIN_READONLY_COMMANDS } from '../../../shared/command-builtin-list';

type ToolsSettingsPanelProps = {
  formValues: AppConfig;
  commandAllowlistText: string;
  commandDenylistText: string;
  downloadAllowedHostsText: string;
  allowedPathsText: string;
  searchRootsText: string;
  draftDirectoryText: string;
  saveStatus: string;
  onChange: (updater: (current: AppConfig) => AppConfig) => void;
  /** 失焦即存：持久化当前表单（多行 / 文本 / 数字字段 onBlur）。 */
  onAutoSave: () => void;
  /** 改即存：切换开关类字段（如自动执行工具）并立即持久化。 */
  onToggle: (updater: (current: AppConfig) => AppConfig) => void;
  onCommandAllowlistChange: (value: string) => void;
  onCommandDenylistChange: (value: string) => void;
  onDownloadAllowedHostsChange: (value: string) => void;
  onAllowedPathsChange: (value: string) => void;
  onSearchRootsChange: (value: string) => void;
  onDraftDirectoryChange: (value: string) => void;
};

/** 内置只读清单（共享常量，模块加载时固定），折叠展示给用户看安全基线。 */
const BUILTIN_COMMANDS = BUILTIN_READONLY_COMMANDS.join('、');

function clampToolRounds(value: number) {
  if (!Number.isFinite(value)) {
    return minToolRounds;
  }
  return Math.min(Math.max(Math.round(value), minToolRounds), maxToolRounds);
}

type ToolChipListProps = {
  tools: SystemToolCatalogItem[];
  selected: string[];
  /** 仅「可配置」（medium）组可勾选；默认放行 / 高危组只作展示。 */
  toggleable: boolean;
  onToggleTool: (toolName: string) => void;
};

/** 工具分组内的 chip 列表。不可勾选的分组不渲染 +/✓ 图标，避免误以为可点。 */
function ToolChipList({ tools, selected, toggleable, onToggleTool }: ToolChipListProps) {
  return (
    <div className="agent-chip-list">
      {tools.map((tool) => {
        const isSelected = selected.includes(tool.name);
        return (
          <button
            key={tool.name}
            type="button"
            className={`agent-selection-chip${isSelected ? ' agent-selection-chip-active' : ''}${toggleable ? '' : ' agent-selection-chip-disabled'}`}
            onClick={() => toggleable && onToggleTool(tool.name)}
            disabled={!toggleable}
            title={tool.description}
          >
            <span>{tool.name}</span>
            {toggleable ? (
              isSelected ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : <Plus size={12} strokeWidth={2} aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ToolsSettingsPanel({
  formValues,
  commandAllowlistText,
  commandDenylistText,
  downloadAllowedHostsText,
  allowedPathsText,
  searchRootsText,
  draftDirectoryText,
  saveStatus,
  onChange,
  onAutoSave,
  onToggle,
  onCommandAllowlistChange,
  onCommandDenylistChange,
  onDownloadAllowedHostsChange,
  onAllowedPathsChange,
  onSearchRootsChange,
  onDraftDirectoryChange,
}: ToolsSettingsPanelProps) {
  const [availableTools, setAvailableTools] = useState<SystemToolCatalogItem[]>([]);
  const autoExecuteTools = formValues.toolSettings?.autoExecuteTools ?? [];

  // 按风险等级分组：medium 可配置（置顶、常驻展开），low/high 只作展示（后置、默认折叠）。
  // download_file 的审批走下载域名白名单，不受自动执行清单影响，故不放进可开启组。
  const configurableTools = availableTools.filter((tool) => tool.risk === 'medium' && tool.name !== downloadToolName);
  const defaultAllowTools = availableTools.filter((tool) => tool.risk === 'low');
  const highRiskTools = availableTools.filter((tool) => tool.risk === 'high');

  useEffect(() => {
    void window.desktopApp.listSystemToolCatalog().then(setAvailableTools).catch(() => {});
  }, []);

  function toggleAutoExecuteTool(toolName: string) {
    onToggle((current) => {
      const list = current.toolSettings?.autoExecuteTools ?? [];
      const next = list.includes(toolName) ? list.filter((name) => name !== toolName) : [...list, toolName];
      return { ...current, toolSettings: { ...current.toolSettings, autoExecuteTools: next } };
    });
  }

  return (
    <section className="settings-panel settings-panel-embedded settings-surface-card">
      <div className="settings-header settings-page-header">
        <div>
          <h3>工具设置</h3>
          <p className="settings-description">配置命令自动执行白名单与本地目录权限</p>
        </div>
        <span className={`settings-save-indicator${saveStatus ? ' settings-save-indicator-visible' : ''}`} aria-live="polite">
          {saveStatus === '已保存' ? <Check size={13} strokeWidth={2.4} aria-hidden="true" /> : null}
          {saveStatus}
        </span>
      </div>

      <div className="settings-form">
        <details className="field">
          <summary>内置只读命令（默认自动放行，只读）</summary>
          <small>{BUILTIN_COMMANDS}</small>
        </details>

        <div className="settings-grid-two-columns">
          <label className="field">
            <span>命令白名单</span>
            <textarea
              rows={5}
              value={commandAllowlistText}
              onChange={(event) => onCommandAllowlistChange(event.target.value)}
              onBlur={onAutoSave}
              placeholder={'每行一条命令前缀，例如：\nnpm run\ngit status\npython'}
            />
            <small>命中前缀的命令自动执行。条目统一按小写存储与匹配。</small>
          </label>

          <label className="field">
            <span>命令黑名单</span>
            <textarea
              rows={5}
              value={commandDenylistText}
              onChange={(event) => onCommandDenylistChange(event.target.value)}
              onBlur={onAutoSave}
              placeholder={'每行一条命令前缀，例如：\ngit push\nnpm publish'}
            />
            <small>黑名单的命令始终弹窗确认，且弹窗不提供「总是允许此命令」。</small>
          </label>
        </div>

        <label className="field">
          <span>下载域名白名单</span>
          <textarea
            rows={3}
            value={downloadAllowedHostsText}
            onChange={(event) => onDownloadAllowedHostsChange(event.target.value)}
            onBlur={onAutoSave}
            placeholder={'每行一个主机名（精确匹配，不支持通配），例如：\nfiles.example.com'}
          />
          <small>`download_file` 从这些域名下载时不再弹确认卡；其余域名需确认一次，可在确认卡勾选「总是允许此域名」自动加入。定时任务与工作流只能从白名单域名下载。</small>
        </label>

        <label className="field">
          <span>最大工具调用轮数</span>
          <input
            type="number"
            min={minToolRounds}
            max={maxToolRounds}
            value={formValues.maxToolRounds}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                maxToolRounds: Number(event.target.value || minToolRounds),
              }))
            }
            onBlur={() => {
              onChange((current) => ({ ...current, maxToolRounds: clampToolRounds(current.maxToolRounds) }));
              onAutoSave();
            }}
          />
          <small>单次请求内允许模型连续调用工具的轮数上限。</small>
        </label>

        <div className="agent-relation-section">
          <div className="agent-relation-header">
            <div>
              <h4>允许自动执行的工具</h4>
            </div>
            <span className="agent-relation-count">{autoExecuteTools.length} 个已允许</span>
          </div>
          <p className="settings-description">勾选后调用这些工具不再弹出确认卡，对所有智能体生效；仅限系统工具，命令执行等高危工具不支持自动执行。</p>
          {availableTools.length === 0 ? (
            <div className="skills-empty">暂无可选工具</div>
          ) : (
            <>
              {configurableTools.length > 0 ? (
                <div className="tool-group">
                  <span className="tool-group-label">可开启 · {configurableTools.length}</span>
                  <ToolChipList
                    tools={configurableTools}
                    selected={autoExecuteTools}
                    toggleable
                    onToggleTool={toggleAutoExecuteTool}
                  />
                </div>
              ) : null}

              {defaultAllowTools.length > 0 ? (
                <details className="tool-group-collapsible">
                  <summary>默认放行 · {defaultAllowTools.length}</summary>
                  <ToolChipList
                    tools={defaultAllowTools}
                    selected={autoExecuteTools}
                    toggleable={false}
                    onToggleTool={toggleAutoExecuteTool}
                  />
                </details>
              ) : null}

              {highRiskTools.length > 0 ? (
                <details className="tool-group-collapsible">
                  <summary>高危不支持 · {highRiskTools.length}</summary>
                  <ToolChipList
                    tools={highRiskTools}
                    selected={autoExecuteTools}
                    toggleable={false}
                    onToggleTool={toggleAutoExecuteTool}
                  />
                </details>
              ) : null}
            </>
          )}
        </div>


        <div className="settings-grid-two-columns">
          <label className="field">
            <span>允许打开的路径</span>
            <textarea
              rows={4}
              value={allowedPathsText}
              onChange={(event) => onAllowedPathsChange(event.target.value)}
              onBlur={onAutoSave}
              placeholder={'每行一个目录，例如：\nC:\\Users\\name\\Desktop'}
            />
            <small>`open_path` 只能访问这些目录及其子目录。</small>
          </label>

          <label className="field">
            <span>搜索目录</span>
            <textarea
              rows={4}
              value={searchRootsText}
              onChange={(event) => onSearchRootsChange(event.target.value)}
              onBlur={onAutoSave}
              placeholder={'每行一个目录，例如：\nC:\\Users\\name\\Documents'}
            />
            <small>`search_files` 只会在这些目录下递归搜索。</small>
          </label>
        </div>

        <label className="field">
          <span>草稿目录</span>
          <input
            type="text"
            value={draftDirectoryText}
            onChange={(event) => onDraftDirectoryChange(event.target.value)}
            onBlur={onAutoSave}
            placeholder="C:\\Users\\name\\Documents\\ErgasterDrafts"
          />
          <small>`create_text_draft` 会将文本保存到这个目录。</small>
        </label>
      </div>
    </section>
  );
}
