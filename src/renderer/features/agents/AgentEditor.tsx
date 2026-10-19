import { Check, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentAvatarColor, AgentProfileDetail } from '../../../shared/agent-profile';
import type { McpServerListItem } from '../../../shared/mcp';
import type { SkillListItem } from '../../../shared/skill-contracts';

type AgentSavePayload = {
  id?: string;
  title: string;
  description: string;
  model: string;
  avatarColor: AgentAvatarColor;
  skillNames: string[];
  uiDslEnabled: boolean;
  uiHtmlEnabled: boolean;
  content: string;
  enabledServerNames: string[];
};

type Props = {
  agent: AgentProfileDetail | null;
  isCreating: boolean;
  availableSkills: SkillListItem[];
  availableMcpServers: McpServerListItem[];
  onSave: (payload: AgentSavePayload) => Promise<void>;
  /** 编辑已有智能体时「改即存」：失焦 / 切换后立即持久化，不关闭编辑器。 */
  onAutoSave: (payload: AgentSavePayload) => Promise<void>;
  onCancel: () => void;
};

const AVATAR_COLORS: { value: AgentAvatarColor; label: string }[] = [
  { value: 'cyan', label: '青色' },
  { value: 'blue', label: '蓝色' },
  { value: 'violet', label: '紫色' },
  { value: 'emerald', label: '绿色' },
  { value: 'amber', label: '琥珀' },
  { value: 'rose', label: '玫红' },
];

export function AgentEditor({ agent, isCreating, availableSkills, availableMcpServers, onSave, onAutoSave, onCancel }: Props) {
  const [title, setTitle] = useState(agent?.title ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [avatarColor, setAvatarColor] = useState<AgentAvatarColor>(agent?.avatarColor ?? 'cyan');
  const [content, setContent] = useState(agent?.content ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement | null>(null);
  const [enabledServerNames, setEnabledServerNames] = useState<string[]>(agent?.mcp.enabledServerNames ?? []);
  const [skillNames, setSkillNames] = useState<string[]>(agent?.skillNames ?? []);
  const [uiDslEnabled, setUiDslEnabled] = useState<boolean>(agent?.uiDslEnabled ?? true);
  const [uiHtmlEnabled, setUiHtmlEnabled] = useState<boolean>(agent?.uiHtmlEnabled ?? false);

  useEffect(() => {
    setTitle(agent?.title ?? '');
    setDescription(agent?.description ?? '');
    setAvatarColor(agent?.avatarColor ?? 'cyan');
    setContent(agent?.content ?? '');
    setEnabledServerNames(agent?.mcp.enabledServerNames ?? []);
    setSkillNames(agent?.skillNames ?? []);
    setUiDslEnabled(agent?.uiDslEnabled ?? true);
    setUiHtmlEnabled(agent?.uiHtmlEnabled ?? false);
    setError('');
  }, [agent]);

  const selectedSkillSet = useMemo(() => new Set(skillNames), [skillNames]);
  const selectedMcpSet = useMemo(() => new Set(enabledServerNames), [enabledServerNames]);

  function showValidationError(message: string) {
    setError(message);
    requestAnimationFrame(() => {
      errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  async function handleSave() {
    const normalizedTitle = title.trim();
    const normalizedDescription = description.trim();
    const normalizedContent = content.trim();

    if (!normalizedTitle) {
      showValidationError('请输入智能体名称。');
      return;
    }

    if (!normalizedDescription) {
      showValidationError('请输入智能体描述。');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await onSave({
        ...(agent?.id ? { id: agent.id } : {}),
        title: normalizedTitle,
        description: normalizedDescription,
        model: '',
        avatarColor,
        skillNames,
        uiDslEnabled,
        uiHtmlEnabled,
        content: normalizedContent,
        enabledServerNames,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存智能体失败');
    } finally {
      setSaving(false);
    }
  }

  /**
   * 编辑已有智能体时「改即存」。失焦（文本）或切换（颜色/芯片/开关）后调用。
   * 校验未过（名称/描述为空）则只提示、不持久化，保留后端上一次的有效值。
   * overrides 用于传入「刚计算出的最新值」，规避 setState 异步导致读到旧 state。
   */
  async function autoSave(overrides?: Partial<AgentSavePayload>) {
    if (isCreating || !agent?.id) {
      return;
    }

    const normalizedTitle = title.trim();
    const normalizedDescription = description.trim();

    if (!normalizedTitle) {
      showValidationError('请输入智能体名称。');
      return;
    }

    if (!normalizedDescription) {
      showValidationError('请输入智能体描述。');
      return;
    }

    setError('');

    try {
      await onAutoSave({
        id: agent.id,
        title: normalizedTitle,
        description: normalizedDescription,
        model: '',
        avatarColor,
        skillNames,
        uiDslEnabled,
        uiHtmlEnabled,
        content: content.trim(),
        enabledServerNames,
        ...overrides,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存智能体失败');
    }
  }

  function toggleSkill(skillName: string) {
    const next = skillNames.includes(skillName) ? skillNames.filter((name) => name !== skillName) : [...skillNames, skillName];
    setSkillNames(next);
    void autoSave({ skillNames: next });
  }

  function toggleMcp(serverName: string) {
    const next = enabledServerNames.includes(serverName) ? enabledServerNames.filter((name) => name !== serverName) : [...enabledServerNames, serverName];
    setEnabledServerNames(next);
    void autoSave({ enabledServerNames: next });
  }

  function selectAvatarColor(color: AgentAvatarColor) {
    setAvatarColor(color);
    void autoSave({ avatarColor: color });
  }

  function toggleUiDsl() {
    const next = !uiDslEnabled;
    setUiDslEnabled(next);
    void autoSave({ uiDslEnabled: next });
  }

  function toggleUiHtml() {
    const next = !uiHtmlEnabled;
    setUiHtmlEnabled(next);
    void autoSave({ uiHtmlEnabled: next });
  }

  return (
    <div className="agent-editor settings-surface-card">
      <div className="editor-header">
        <div>
          <h3>{isCreating ? '创建智能体' : '编辑智能体'}</h3>
        </div>
      </div>

      {error ? <div ref={errorRef} className="skills-message skills-message-error" role="alert">{error}</div> : null}

      <div className="settings-grid-two-columns">
        <label className="field">
          <span>名称</span>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void autoSave()}
            placeholder="例如：会议纪要助手"
            disabled={saving}
          />
        </label>
      </div>

      <label className="field">
        <span>描述</span>
        <input
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => void autoSave()}
          placeholder="简要说明这个智能体擅长处理什么任务"
          disabled={saving}
        />
      </label>

      <div className="field">
        <span>头像颜色</span>
        <div className="agent-color-grid">
          {AVATAR_COLORS.map((colorItem) => {
            const selected = colorItem.value === avatarColor;
            return (
              <button
                key={colorItem.value}
                type="button"
                className={`agent-color-swatch agent-avatar-${colorItem.value}${selected ? ' agent-color-swatch-active' : ''}`}
                onClick={() => selectAvatarColor(colorItem.value)}
                disabled={saving}
                aria-label={`选择${colorItem.label}头像颜色`}
                aria-pressed={selected}
              />
            );
          })}
        </div>
      </div>

      <label className="field">
        <span>系统提示词</span>
        <textarea
          className="agent-textarea"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onBlur={() => void autoSave()}
          placeholder="请输入要作为预置提示词发送给模型的系统提示词..."
          spellCheck={false}
          disabled={saving}
        />
      </label>

      <div className="agent-relation-section">
        <div className="agent-relation-header">
          <div>
            <h4>关联 Skills</h4>
          </div>
          <span className="agent-relation-count">{skillNames.length} 个已关联</span>
        </div>
        {availableSkills.length === 0 ? (
          <div className="skills-empty">暂无可选 Skills</div>
        ) : (
          <div className="agent-chip-list">
            {availableSkills.map((skill) => {
              const selected = selectedSkillSet.has(skill.name);
              return (
                <button
                  key={skill.directoryName}
                  type="button"
                  className={`agent-selection-chip${selected ? ' agent-selection-chip-active' : ''}`}
                  onClick={() => toggleSkill(skill.name)}
                  disabled={saving}
                >
                  <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
                  <span>{skill.name}</span>
                  {selected ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : <Plus size={12} strokeWidth={2} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="agent-relation-section">
        <div className="agent-relation-header">
          <div>
            <h4>关联 MCP 服务</h4>
          </div>
          <span className="agent-relation-count">{enabledServerNames.length} 个已关联</span>
        </div>
        {availableMcpServers.length === 0 ? (
          <div className="skills-empty">暂无可选 MCP 服务</div>
        ) : (
          <div className="agent-chip-list">
            {availableMcpServers.map((server) => {
              const selected = selectedMcpSet.has(server.name);
              return (
                <button
                  key={server.name}
                  type="button"
                  className={`agent-selection-chip${selected ? ' agent-selection-chip-active' : ''}`}
                  onClick={() => toggleMcp(server.name)}
                  disabled={saving}
                >
                  <span>{server.name}{server.disabled ? '（已关闭）' : ''}</span>
                  {selected ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : <Plus size={12} strokeWidth={2} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="agent-relation-section">
        <div className="agent-relation-header">
          <div>
            <h4>会话交互UI</h4>
          </div>
        </div>
        <p className="settings-description">开启后该智能体可在会话时输出JSON UI 和 HTML</p>
        <div className="agent-chip-list">
          <button
            type="button"
            className={`agent-selection-chip${uiDslEnabled ? ' agent-selection-chip-active' : ''}`}
            onClick={toggleUiDsl}
            disabled={saving}
          >
            <span>允许使用 JSON UI</span>
            {uiDslEnabled ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : <Plus size={12} strokeWidth={2} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className={`agent-selection-chip${uiHtmlEnabled ? ' agent-selection-chip-active' : ''}`}
            onClick={toggleUiHtml}
            disabled={saving}
          >
            <span>允许使用 HTML</span>
            {uiHtmlEnabled ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : <Plus size={12} strokeWidth={2} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div className="editor-actions">
        {isCreating ? (
          <>
            <button type="button" className="save-button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? '创建中...' : '创建智能体'}
            </button>
            <button type="button" className="cancel-button" onClick={onCancel} disabled={saving}>
              <X size={14} strokeWidth={2} aria-hidden="true" />
              <span>取消</span>
            </button>
          </>
        ) : (
          <button type="button" className="cancel-button" onClick={onCancel}>
            <span>返回</span>
          </button>
        )}
      </div>
    </div>
  );
}
