import { ChevronDown, FilePenLine, Plus, Star, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { MailAccountInput, MailAccountListItem, MailSecurity } from '../../../shared/mail';
import { MAIL_DEFAULT_PORT } from '../../../shared/mail';

type Props = {
  onClose: () => void;
};

type EditorState = {
  id?: string;
  label: string;
  host: string;
  port: number;
  security: MailSecurity;
  user: string;
  password: string;
  isDefault: boolean;
};

const emptyEditor: EditorState = {
  label: '',
  host: '',
  port: MAIL_DEFAULT_PORT,
  security: 'tls',
  user: '',
  password: '',
  isDefault: false,
};

const securityOptions: { value: MailSecurity; label: string }[] = [
  { value: 'tls', label: 'SSL/TLS（推荐，端口通常 993）' },
  { value: 'starttls', label: 'STARTTLS（端口通常 143）' },
  { value: 'none', label: '不加密（不推荐）' },
];

type ConnState = { state: 'testing' | 'ok' | 'fail'; error?: string };

// 复用 MCP 传输方式下拉的同套样式（mcp-select-*），与模型/服务下拉观感一致。
function SecuritySelect({ value, disabled, onChange }: {
  value: MailSecurity;
  disabled: boolean;
  onChange: (next: MailSecurity) => void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const currentLabel = securityOptions.find((option) => option.value === value)?.label ?? value;

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
        aria-label="选择加密方式"
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
        <div className="mcp-select-menu" id={listboxId} role="listbox" aria-label="加密方式列表">
          {securityOptions.map((option) => {
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

export function MailAccountsPanel(_props: Props) {
  const [accounts, setAccounts] = useState<MailAccountListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connStatus, setConnStatus] = useState<Record<string, ConnState>>({});

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
      const list = await window.desktopApp.listMailAccounts();
      setAccounts(list);
      checkAllConnections(list);
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : '加载邮箱账户失败');
    } finally {
      setLoading(false);
    }
  }

  async function checkConnection(account: MailAccountListItem) {
    setConnStatus((current) => ({ ...current, [account.id]: { state: 'testing' as const } }));
    try {
      const result = await window.desktopApp.testMailAccountById(account.id);
      setConnStatus((current) => ({
        ...current,
        [account.id]: result.ok ? { state: 'ok' as const } : { state: 'fail' as const, error: result.error },
      }));
    } catch (error) {
      setConnStatus((current) => ({
        ...current,
        [account.id]: { state: 'fail' as const, error: error instanceof Error ? error.message : '检测失败' },
      }));
    }
  }

  function checkAllConnections(list: MailAccountListItem[]) {
    list.forEach((account) => void checkConnection(account));
  }

  function startCreate() {
    setEditing({ ...emptyEditor });
  }

  function startEdit(account: MailAccountListItem) {
    setEditing({
      id: account.id,
      label: account.label,
      host: account.host,
      port: account.port,
      security: account.security,
      user: account.user,
      password: '',
      isDefault: account.isDefault,
    });
  }

  function toInput(state: EditorState): MailAccountInput {
    return {
      id: state.id,
      label: state.label.trim(),
      host: state.host.trim(),
      port: state.port,
      security: state.security,
      user: state.user.trim(),
      password: state.password.length > 0 ? state.password : undefined,
      isDefault: state.isDefault,
    };
  }

  async function handleSave() {
    if (!editing) {
      return;
    }
    setSaving(true);
    try {
      const result = await window.desktopApp.saveMailAccount(toInput(editing));
      if (!result.ok) {
        throw new Error(result.error ?? '保存邮箱账户失败');
      }
      showMessage('success', editing.id ? '邮箱账户已更新' : '邮箱账户已创建');
      setEditing(null);
      await loadData();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : '保存邮箱账户失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!editing) {
      return;
    }
    setTesting(true);
    try {
      const result = await window.desktopApp.testMailAccount(toInput(editing));
      if (result.ok) {
        showMessage('success', '连接成功');
      } else {
        showMessage('error', result.error ?? '连接失败');
      }
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : '连接失败');
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete(account: MailAccountListItem) {
    if (!confirm(`确定要删除邮箱账户“${account.label}”吗？`)) {
      return;
    }
    const result = await window.desktopApp.deleteMailAccount(account.id);
    if (!result.ok) {
      showMessage('error', result.error ?? '删除失败');
      return;
    }
    showMessage('success', '邮箱账户已删除');
    await loadData();
  }

  async function handleSetDefault(account: MailAccountListItem) {
    const result = await window.desktopApp.setDefaultMailAccount(account.id);
    if (!result.ok) {
      showMessage('error', result.error ?? '设置默认账户失败');
      return;
    }
    showMessage('success', `已将“${account.label}”设为默认账户`);
    await loadData();
  }

  return (
    <div className="skills-panel settings-surface-card">
      <div className="skills-header settings-page-header">
        <div>
          <h2>邮箱账户</h2>
          <p className="settings-description">配置 IMAP 账户后，智能体可只读列出、搜索与阅读邮件。密码经系统密钥库加密存储。</p>
        </div>
        {!editing ? (
          <div className="skills-header-actions">
            <button className="ghost-button" type="button" onClick={() => checkAllConnections(accounts)} disabled={loading}>
              <span>重新检测</span>
            </button>
            <button className="create-button" type="button" onClick={startCreate}>
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              <span>新增账户</span>
            </button>
          </div>
        ) : null}
      </div>

      {message ? <div className={`skills-message skills-message-${message.type}`}>{message.text}</div> : null}

      <div className="skills-content">
        {editing ? (
          <div className="mcp-editor settings-surface-card">
            <div className="editor-header">
              <div><h3>{editing.id ? '编辑邮箱账户' : '新增邮箱账户'}</h3></div>
            </div>

            <div className="settings-grid-two-columns">
              <label className="field">
                <span>账户名称</span>
                <input type="text" value={editing.label} onChange={(event) => setEditing((current) => current ? { ...current, label: event.target.value } : current)} disabled={saving} placeholder="例如：工作邮箱" />
              </label>
              <label className="field">
                <span>登录用户名</span>
                <input type="text" autoComplete="off" value={editing.user} onChange={(event) => setEditing((current) => current ? { ...current, user: event.target.value } : current)} disabled={saving} placeholder="you@example.com" />
              </label>
            </div>

            <div className="settings-grid-two-columns">
              <label className="field">
                <span>IMAP 服务器</span>
                <input type="text" value={editing.host} onChange={(event) => setEditing((current) => current ? { ...current, host: event.target.value } : current)} disabled={saving} placeholder="imap.example.com" />
              </label>
              <label className="field">
                <span>端口</span>
                <input type="number" min={1} max={65535} value={editing.port} onChange={(event) => setEditing((current) => current ? { ...current, port: Number(event.target.value || MAIL_DEFAULT_PORT) } : current)} disabled={saving} />
              </label>
            </div>
            <div className="settings-grid-two-columns">
              <div className="field">
                <span>加密方式</span>
                <SecuritySelect
                  value={editing.security}
                  disabled={saving}
                  onChange={(next) => setEditing((current) => current ? { ...current, security: next } : current)}
                />
              </div>
              <label className="field">
                <span>密码 / 应用专用密码</span>
                <input type="password" autoComplete="new-password" value={editing.password} onChange={(event) => setEditing((current) => current ? { ...current, password: event.target.value } : current)} disabled={saving} placeholder={editing.id ? '留空表示不修改已保存密码' : '请输入密码'} />
              </label>
            </div>

            <label className="settings-checkbox-row">
              <input type="checkbox" checked={editing.isDefault} onChange={(event) => setEditing((current) => current ? { ...current, isDefault: event.target.checked } : current)} disabled={saving} />
              <span>设为默认账户（工具未指定 accountId 时使用）</span>
            </label>

            <div className="editor-actions">
              <button type="button" className="save-button" onClick={() => void handleSave()} disabled={saving}>{saving ? '保存中...' : '保存账户'}</button>
              <button type="button" className="ghost-button" onClick={() => void handleTest()} disabled={saving || testing}>{testing ? '测试中...' : '测试连接'}</button>
              <button type="button" className="cancel-button" onClick={() => setEditing(null)} disabled={saving}>
                <X size={14} strokeWidth={2} aria-hidden="true" /><span>取消</span>
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="skills-loading">加载中...</div>
        ) : accounts.length === 0 ? (
          <div className="skills-empty"><p>暂无邮箱账户</p><p>点击右上角「新增账户」添加 IMAP 邮箱。</p></div>
        ) : (
          <div className="skills-list">
            {accounts.map((account) => (
              <div key={account.id} className="skill-item settings-list-item" onDoubleClick={() => startEdit(account)}>
                <div className="skill-info">
                  <h3 className="skill-name">{account.label}{account.isDefault ? '（默认）' : ''}</h3>
                  <p className="skill-description">{account.user} — {account.host}:{account.port}</p>
                  <p className="skill-description">
                    {(() => {
                      const status = connStatus[account.id];
                      if (!status || status.state === 'testing') {
                        return <span className="mail-conn-status mail-conn-testing">连接检测中…</span>;
                      }
                      return status.state === 'ok'
                        ? <span className="mail-conn-status mail-conn-ok">✓ 连接成功</span>
                        : <span className="mail-conn-status mail-conn-fail">✗ 连接失败：{status.error ?? '未知原因'}</span>;
                    })()}
                  </p>
                </div>
                <div className="skill-actions skill-actions-icon-only">
                  <button className="icon-button" type="button" onClick={() => void handleSetDefault(account)} aria-label={`设为默认 ${account.label}`} title={account.isDefault ? '当前默认账户：工具未指定账户时使用它' : '设为默认账户：工具未指定账户时使用它'} disabled={account.isDefault}>
                    <Star size={15} strokeWidth={2} />
                  </button>
                  <button className="edit-button icon-button" type="button" onClick={() => startEdit(account)} aria-label={`编辑 ${account.label}`}>
                    <FilePenLine size={15} strokeWidth={2} />
                  </button>
                  <button className="delete-button icon-button" type="button" onClick={() => void handleDelete(account)} aria-label={`删除 ${account.label}`}>
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
