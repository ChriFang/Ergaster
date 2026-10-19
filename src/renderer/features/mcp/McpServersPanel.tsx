import { ChevronDown, FilePenLine, FileText, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { McpServerConfig, McpServerListItem, McpTransportType } from '../../../shared/mcp';

type Props = {
  onClose: () => void;
};

const transportOptions: { value: McpTransportType; label: string }[] = [
  { value: 'stdio', label: 'stdio（本地命令）' },
  { value: 'streamable-http', label: 'streamable-http（HTTP 服务）' },
];

type EditorState = {
  originalName?: string;
  name: string;
  transport: McpTransportType;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
  disabled: boolean;
};

type ViewMode = 'list' | 'editor';

const emptyEditor: EditorState = {
  name: '',
  transport: 'stdio',
  command: '',
  argsText: '',
  envText: '',
  url: '',
  headersText: '',
  disabled: false,
};

function serializeKeyValues(values: Record<string, string>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function parseArgsText(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseKeyValueText(value: string, label: string) {
  const result: Record<string, string> = {};
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`${label}格式错误：${line}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const entryValue = line.slice(separatorIndex + 1);
    if (!key) {
      throw new Error(`${label}键不能为空：${line}`);
    }

    result[key] = entryValue;
  }

  return result;
}

function TransportSelect({ value, disabled, onChange }: {
  value: McpTransportType;
  disabled: boolean;
  onChange: (next: McpTransportType) => void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const currentLabel = transportOptions.find((option) => option.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="mcp-select-dropdown" ref={dropdownRef}>
      <button
        type="button"
        className="mcp-select-trigger"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-label="选择传输方式"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
      >
        <span className="mcp-select-trigger-label">{currentLabel}</span>
        <ChevronDown
          className={open ? 'mcp-select-trigger-icon mcp-select-trigger-icon-open' : 'mcp-select-trigger-icon'}
          size={16}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="mcp-select-menu" id={listboxId} role="listbox" aria-label="传输方式列表">
          {transportOptions.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={selected ? 'mcp-select-option mcp-select-option-selected' : 'mcp-select-option'}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function McpServersPanel({ onClose }: Props) {
  const [servers, setServers] = useState<McpServerListItem[]>([]);
  const [serverConfigs, setServerConfigs] = useState<Record<string, McpServerConfig>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 3000);
  }

  async function loadData() {
    setLoading(true);
    try {
      const [list, config] = await Promise.all([
        window.desktopApp.listMcpServers(),
        window.desktopApp.getMcpConfig(),
      ]);
      setServers(list);
      setServerConfigs(config.mcpServers);
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : '加载 MCP 配置失败');
    } finally {
      setLoading(false);
    }
  }

  function startCreate() {
    setEditing(emptyEditor);
    setViewMode('editor');
  }

  function startEdit(server: McpServerListItem) {
    const stored = serverConfigs[server.name];
    const headers = stored && stored.transport === 'streamable-http' ? stored.headers ?? {} : {};

    setEditing({
      originalName: server.name,
      name: server.name,
      transport: server.transport,
      command: server.command,
      argsText: server.args.join('\n'),
      envText: serializeKeyValues(server.env),
      url: server.url,
      headersText: serializeKeyValues(headers),
      disabled: server.disabled,
    });
    setViewMode('editor');
  }

  async function handleDelete(server: McpServerListItem) {
    if (!confirm(`确定要删除 MCP 服务“${server.name}”吗？\n\n如果某个智能体已引用该服务，也会同步移除。`)) {
      return;
    }

    const result = await window.desktopApp.deleteMcpServer(server.name);
    if (!result.ok) {
      showMessage('error', result.error ?? '删除 MCP 服务失败');
      return;
    }

    showMessage('success', `MCP 服务“${server.name}”已删除`);
    await loadData();
  }

  async function handleSaveEditor() {
    if (!editing) {
      return;
    }

    setSaving(true);
    try {
      const base = {
        originalName: editing.originalName,
        name: editing.name.trim(),
        transport: editing.transport,
        disabled: editing.disabled,
      };
      const result = await window.desktopApp.saveMcpServer(
        editing.transport === 'streamable-http'
          ? {
            ...base,
            url: editing.url.trim(),
            headers: parseKeyValueText(editing.headersText, '请求头'),
          }
          : {
            ...base,
            command: editing.command.trim(),
            args: parseArgsText(editing.argsText),
            env: parseKeyValueText(editing.envText, '环境变量'),
          },
      );

      if (!result.ok) {
        throw new Error(result.error ?? '保存 MCP 服务失败');
      }

      showMessage('success', editing.originalName ? 'MCP 服务已更新' : 'MCP 服务已创建');
      setEditing(null);
      setViewMode('list');
      await loadData();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : '保存 MCP 服务失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleOpenConfigFile() {
    try {
      await window.desktopApp.openMcpConfigFile();
    } catch {
      showMessage('error', '打开 MCP 文件失败');
    }
  }

  async function handleToggleServer(server: McpServerListItem) {
    const stored = serverConfigs[server.name];
    const base = {
      originalName: server.name,
      name: server.name,
      transport: server.transport,
      disabled: !server.disabled,
    };
    const result = await window.desktopApp.saveMcpServer(
      server.transport === 'streamable-http'
        ? {
          ...base,
          url: server.url,
          headers: stored && stored.transport === 'streamable-http' ? stored.headers ?? {} : {},
        }
        : {
          ...base,
          command: server.command,
          args: server.args,
          env: server.env,
        },
    );

    if (!result.ok) {
      showMessage('error', result.error ?? '切换 MCP 状态失败');
      return;
    }

    showMessage('success', server.disabled ? 'MCP 服务已启用' : 'MCP 服务已停用');
    await loadData();
  }

  return (
    <div className="skills-panel settings-surface-card">
      <div className="skills-header settings-page-header">
        <div>
          <h2>MCP 服务管理</h2>
          <p className="settings-description">统一管理 MCP 服务的启用状态与命令参数。</p>
        </div>
        {viewMode === 'list' ? (
          <div className="skills-header-actions">
            <button className="ghost-button" type="button" onClick={handleOpenConfigFile}>
              <FileText size={15} strokeWidth={2} aria-hidden="true" />
              <span>打开 MCP 文件</span>
            </button>
            <button className="create-button" type="button" onClick={startCreate}>
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              <span>新增服务</span>
            </button>
          </div>
        ) : null}
      </div>

      {message ? <div className={`skills-message skills-message-${message.type}`}>{message.text}</div> : null}

      <div className="skills-content">
        {viewMode === 'editor' && editing ? (
          <div className="mcp-editor settings-surface-card">
            <div className="editor-header">
              <div>
                <h3>{editing.originalName ? '编辑 MCP 服务' : '新增 MCP 服务'}</h3>
              </div>
            </div>

            <div className="settings-grid-two-columns">
              <label className="field">
                <span>MCP 名称</span>
                <input
                  type="text"
                  value={editing.name}
                  onChange={(event) => setEditing((current) => current ? { ...current, name: event.target.value } : current)}
                  disabled={saving}
                />
              </label>

              <div className="field">
                <span>传输方式</span>
                <TransportSelect
                  value={editing.transport}
                  disabled={saving}
                  onChange={(next) => setEditing((current) => current ? { ...current, transport: next } : current)}
                />
              </div>
            </div>

            <div className="settings-grid-two-columns">
              <label className="field">
                <span>状态</span>
                <div className="settings-switch-row">
                  <span className="settings-switch-label">{editing.disabled ? '已停用' : '已启用'}</span>
                  <button
                    type="button"
                    className={`${!editing.disabled ? 'settings-switch settings-switch-checked' : 'settings-switch'}`}
                    role="switch"
                    aria-checked={!editing.disabled}
                    aria-label={!editing.disabled ? '停用 MCP 服务' : '启用 MCP 服务'}
                    onClick={() => setEditing((current) => current ? { ...current, disabled: !current.disabled } : current)}
                    disabled={saving}
                  >
                    <span className="settings-switch-thumb" />
                  </button>
                </div>
              </label>
            </div>

            {editing.transport === 'streamable-http' ? (
              <>
                <label className="field">
                  <span>服务地址</span>
                  <input
                    type="text"
                    value={editing.url}
                    onChange={(event) => setEditing((current) => current ? { ...current, url: event.target.value } : current)}
                    placeholder="https://example.com/mcp"
                    disabled={saving}
                  />
                </label>

                <label className="field">
                  <span>请求头</span>
                  <textarea
                    className="mcp-editor-textarea"
                    value={editing.headersText}
                    onChange={(event) => setEditing((current) => current ? { ...current, headersText: event.target.value } : current)}
                    placeholder="每行一个 KEY=VALUE，例如 Authorization=Bearer xxx"
                    disabled={saving}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>命令</span>
                  <input
                    type="text"
                    value={editing.command}
                    onChange={(event) => setEditing((current) => current ? { ...current, command: event.target.value } : current)}
                    disabled={saving}
                  />
                </label>

                <div className="settings-grid-two-columns">
                  <label className="field">
                    <span>参数</span>
                    <textarea
                      className="mcp-editor-textarea"
                      value={editing.argsText}
                      onChange={(event) => setEditing((current) => current ? { ...current, argsText: event.target.value } : current)}
                      placeholder="每行一个参数"
                      disabled={saving}
                    />
                  </label>

                  <label className="field">
                    <span>环境变量</span>
                    <textarea
                      className="mcp-editor-textarea"
                      value={editing.envText}
                      onChange={(event) => setEditing((current) => current ? { ...current, envText: event.target.value } : current)}
                      placeholder="每行一个 KEY=VALUE"
                      disabled={saving}
                    />
                  </label>
                </div>
              </>
            )}

            <div className="editor-actions">
              <button type="button" className="save-button" onClick={() => void handleSaveEditor()} disabled={saving}>
                {saving ? '保存中...' : '保存服务'}
              </button>
              <button type="button" className="cancel-button" onClick={() => setViewMode('list')} disabled={saving}>
                <X size={14} strokeWidth={2} aria-hidden="true" />
                <span>取消</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {loading ? (
              <div className="skills-loading">加载中...</div>
            ) : servers.length === 0 ? (
              <div className="skills-empty">
                <p>暂无 MCP 服务</p>
                <p>点击右上角按钮创建新的 MCP 服务。</p>
              </div>
            ) : (
              <div className="skills-list">
                {servers.map((server) => (
                  <div key={server.name} className="skill-item settings-list-item mcp-server-item" onDoubleClick={() => startEdit(server)}>
                    <div className="skill-info">
                      <h3 className="skill-name">{server.name}</h3>
                      <p className="skill-description">
                        {server.transport === 'streamable-http' ? server.url : server.command}
                      </p>
                    </div>
                    <div className="skill-actions skill-actions-icon-only">
                      <button
                        className={`${!server.disabled ? 'settings-switch settings-switch-checked' : 'settings-switch'}`}
                        type="button"
                        role="switch"
                        aria-checked={!server.disabled}
                        aria-label={server.disabled ? `启用 ${server.name}` : `停用 ${server.name}`}
                        onClick={() => void handleToggleServer(server)}
                      >
                        <span className="settings-switch-thumb" />
                      </button>
                      <button className="edit-button icon-button" type="button" onClick={() => startEdit(server)} aria-label={`编辑 ${server.name}`}>
                        <FilePenLine size={15} strokeWidth={2} />
                      </button>
                      <button className="delete-button icon-button" type="button" onClick={() => void handleDelete(server)} aria-label={`删除 ${server.name}`}>
                        <Trash2 size={15} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
