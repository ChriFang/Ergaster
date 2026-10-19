import { Check, Eye, EyeOff } from 'lucide-react';
import type { AppConfig, MaskedAppConfig, WindowCloseAction } from '../../../shared/config';
import { maxModelIdleTimeoutSeconds, minModelIdleTimeoutSeconds } from '../../../shared/config';

/** GitHub Fine-grained Token 创建页；点击经主进程在系统浏览器打开。 */
const TOKEN_CREATE_URL = 'https://github.com/settings/personal-access-tokens/new';

const CLOSE_ACTION_OPTIONS: Array<{ value: WindowCloseAction; label: string }> = [
  { value: 'ask', label: '每次询问' },
  { value: 'minimize', label: '最小化到托盘' },
  { value: 'exit', label: '直接退出' },
];

function clampIdleTimeout(value: number) {
  if (!Number.isFinite(value)) {
    return minModelIdleTimeoutSeconds;
  }
  return Math.min(Math.max(Math.round(value), minModelIdleTimeoutSeconds), maxModelIdleTimeoutSeconds);
}

type SettingsPanelProps = {
  config: MaskedAppConfig | null;
  formValues: AppConfig;
  showApiKey: boolean;
  showGithubToken: boolean;
  saveStatus: string;
  onToggleShowApiKey: () => void;
  onToggleShowGithubToken: () => void;
  onChange: (updater: (current: AppConfig) => AppConfig) => void;
  /** 失焦即存：持久化当前表单（文本 / 数字 / 密钥字段 onBlur）。 */
  onAutoSave: () => void;
  /** 改即存：切换开关类字段并立即持久化。 */
  onToggle: (updater: (current: AppConfig) => AppConfig) => void;
  /** API Key / Base URL 失焦：持久化并刷新模型列表。 */
  onModelConnectionCommit: () => void;
  onCloseActionChange: (value: WindowCloseAction) => void;
};

export function SettingsPanel({
  config,
  formValues,
  showApiKey,
  showGithubToken,
  saveStatus,
  onToggleShowApiKey,
  onToggleShowGithubToken,
  onChange,
  onAutoSave,
  onToggle,
  onModelConnectionCommit,
  onCloseActionChange,
}: SettingsPanelProps) {
  return (
    <section className="settings-panel settings-panel-embedded settings-surface-card">
      <div className="settings-header settings-page-header">
        <div>
          <h3>通用设置</h3>
          <p className="settings-description">配置模型、连接与本地目录权限</p>
        </div>
        <span className={`settings-save-indicator${saveStatus ? ' settings-save-indicator-visible' : ''}`} aria-live="polite">
          {saveStatus === '已保存' ? <Check size={13} strokeWidth={2.4} aria-hidden="true" /> : null}
          {saveStatus}
        </span>
      </div>

      <div className="settings-form">
        <label className="field">
          <span>API Key</span>
          <div className="field-input-overlay">
            <input
              type={showApiKey ? 'text' : 'password'}
              autoComplete="off"
              value={formValues.deepseekApiKey}
              onChange={(event) => onChange((current) => ({ ...current, deepseekApiKey: event.target.value }))}
              onBlur={onModelConnectionCommit}
              placeholder={config?.hasApiKey ? '输入新 API Key 以覆盖当前值' : '请输入 API Key'}
            />
            <button
              className="field-overlay-button"
              type="button"
              aria-label={showApiKey ? '隐藏明文' : '查看明文'}
              title={showApiKey ? '隐藏明文' : '查看明文'}
              onClick={onToggleShowApiKey}
            >
              {showApiKey ? <EyeOff size={18} strokeWidth={2} aria-hidden="true" /> : <Eye size={18} strokeWidth={2} aria-hidden="true" />}
            </button>
          </div>
          {config?.hasApiKey ? <small>当前已保存：{config.maskedApiKey}</small> : null}
        </label>

        <label className="field">
          <span>API Base URL</span>
          <input
            type="url"
            value={formValues.apiBaseUrl}
            onChange={(event) => onChange((current) => ({ ...current, apiBaseUrl: event.target.value }))}
            onBlur={onModelConnectionCommit}
            placeholder="例如：https://api.example.com/v1"
          />
        </label>

        <div className="one-api-compatibility-group">
          <span>兼容 OneAPI</span>
          <label className="one-api-compatibility-field">
            <small>使用更保守的工具调用格式，并在流式工具调用不完整时自动非流式重试。</small>
            <input
              type="checkbox"
              checked={formValues.oneApiCompatibilityEnabled}
              onChange={(event) => onToggle((current) => ({ ...current, oneApiCompatibilityEnabled: event.target.checked }))}
            />
          </label>
        </div>

        <div className="one-api-compatibility-group">
          <span>长期记忆</span>
          <label className="one-api-compatibility-field">
            <small>跨会话记住关于你的稳定事实与偏好并在对话中自动利用；模型也可用 memory_* 工具增删。</small>
            <input
              type="checkbox"
              checked={formValues.memoryEnabled}
              onChange={(event) => onToggle((current) => ({ ...current, memoryEnabled: event.target.checked }))}
            />
          </label>
        </div>



        <label className="field">
          <span>模型响应空闲超时（秒）</span>
          <input
            type="number"
            min={minModelIdleTimeoutSeconds}
            max={maxModelIdleTimeoutSeconds}
            value={formValues.modelIdleTimeoutSeconds}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                modelIdleTimeoutSeconds: Number(event.target.value || minModelIdleTimeoutSeconds),
              }))
            }
            onBlur={() => {
              onChange((current) => ({ ...current, modelIdleTimeoutSeconds: clampIdleTimeout(current.modelIdleTimeoutSeconds) }));
              onAutoSave();
            }}
          />
          <small>连续这么久没有收到新数据才判定超时；回复本身多长都不受限制。</small>
        </label>

        <label className="field">
          <span>GitHub Token</span>
          <div className="field-input-overlay">
            <input
              type={showGithubToken ? 'text' : 'password'}
              autoComplete="off"
              value={formValues.githubToken}
              onChange={(event) => onChange((current) => ({ ...current, githubToken: event.target.value }))}
              onBlur={onAutoSave}
              placeholder={config?.hasGithubToken ? '输入新 Token 以覆盖当前值' : '可选，用于安装 GitHub 上的 Skill'}
            />
            <button
              className="field-overlay-button"
              type="button"
              aria-label={showGithubToken ? '隐藏明文' : '查看明文'}
              title={showGithubToken ? '隐藏明文' : '查看明文'}
              onClick={onToggleShowGithubToken}
            >
              {showGithubToken ? <EyeOff size={18} strokeWidth={2} aria-hidden="true" /> : <Eye size={18} strokeWidth={2} aria-hidden="true" />}
            </button>
          </div>
          <small>
            安装 GitHub 上的 Skill 时随请求发送，把匿名 API 限额（60 次/小时）提升到 5000 次/小时；
            <a
              style={{ color: 'var(--accent, #3b82f6)' }}
              href={TOKEN_CREATE_URL}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                void window.desktopApp.openExternalLink(TOKEN_CREATE_URL).catch((error: unknown) => {
                  console.error('打开链接失败', error instanceof Error ? error.message : String(error));
                });
              }}
            >
              前往创建 Token
            </a>
          </small>
          {config?.hasGithubToken ? <small>当前已保存：{config.maskedGithubToken}</small> : null}
        </label>

        <div className="field">
          <span>关闭按钮行为</span>
          <div className="settings-segmented" role="group" aria-label="关闭按钮行为">
            {CLOSE_ACTION_OPTIONS.map((option) => {
              const selected = formValues.closeAction === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={selected ? 'settings-segmented-item settings-segmented-item-active' : 'settings-segmented-item'}
                  aria-pressed={selected}
                  onClick={() => onCloseActionChange(option.value)}
                >
                  {option.label}
                </button>
              );
          })}
          </div>
        </div>
      </div>
    </section>
  );
}
