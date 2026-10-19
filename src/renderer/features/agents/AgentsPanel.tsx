import { FilePenLine, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_AGENT_ID, type AgentProfileDetail, type AgentProfileListItem } from '../../../shared/agent-profile';
import type { McpServerListItem } from '../../../shared/mcp';
import type { SkillListItem } from '../../../shared/skill-contracts';
import { AgentEditor } from './AgentEditor';

type Props = {
  onClose: () => void;
  onAgentsChanged?: (agents: AgentProfileListItem[]) => void;
  startCreating?: boolean;
  initialAgentId?: string;
};

type AgentSavePayload = {
  id?: string;
  title: string;
  description: string;
  model: string;
  avatarColor: AgentProfileDetail['avatarColor'];
  skillNames: string[];
  uiDslEnabled: boolean;
  uiHtmlEnabled: boolean;
  content: string;
  enabledServerNames: string[];
};

function getAgentInitial(title: string) {
  return title.trim().charAt(0).toUpperCase() || '?';
}

function toAgentListItem(agent: AgentProfileDetail): AgentProfileListItem {
  return {
    id: agent.id,
    title: agent.title,
    description: agent.description,
    model: agent.model,
    avatarColor: agent.avatarColor,
    skillNames: [...agent.skillNames],
    uiDslEnabled: agent.uiDslEnabled,
    uiHtmlEnabled: agent.uiHtmlEnabled,
    directoryName: agent.directoryName,
    directoryPath: agent.directoryPath,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    mcp: {
      enabledServerNames: [...agent.mcp.enabledServerNames],
    },
  };
}

function sortAgentsByUpdatedAt(items: AgentProfileListItem[]) {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function upsertAgentListItem(items: AgentProfileListItem[], nextItem: AgentProfileListItem) {
  return sortAgentsByUpdatedAt([...items.filter((item) => item.id !== nextItem.id), nextItem]);
}

function createBlankAgent(): AgentProfileDetail {
  return {
    id: '',
    title: '',
    description: '',
    model: '',
    avatarColor: 'cyan',
    skillNames: [],
    uiDslEnabled: true,
    uiHtmlEnabled: false,
    content: '',
    directoryName: '',
    directoryPath: '',
    createdAt: '',
    updatedAt: '',
    mcp: {
      enabledServerNames: [],
    },
  };
}

export function AgentsPanel({ onClose, onAgentsChanged, startCreating, initialAgentId }: Props) {
  const [agents, setAgents] = useState<AgentProfileListItem[]>([]);
  const [editingAgent, setEditingAgent] = useState<AgentProfileDetail | null>(() => (startCreating ? createBlankAgent() : null));
  const [isCreating, setIsCreating] = useState(() => Boolean(startCreating));
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [availableMcpServers, setAvailableMcpServers] = useState<McpServerListItem[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillListItem[]>([]);
  const initialEditRequestedRef = useRef<string | null>(null);

  useEffect(() => {
    void loadAgents();
    void loadMcpServers();
    void loadSkills();
  }, []);

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 3000);
  }

  async function loadAgents() {
    setLoading(true);
    try {
      await window.desktopApp.reloadAgents();
      const result = await window.desktopApp.listAgents();
      setAgents(result);
      onAgentsChanged?.(result);
    } catch {
      showMessage('error', '加载智能体列表失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadMcpServers() {
    try {
      const result = await window.desktopApp.listMcpServers();
      setAvailableMcpServers(result);
    } catch {
      showMessage('error', '加载 MCP 服务列表失败');
    }
  }

  async function loadSkills() {
    try {
      const result = await window.desktopApp.listSkills();
      setAvailableSkills(result);
    } catch {
      showMessage('error', '加载 Skills 列表失败');
    }
  }

  async function handleOpenDirectory() {
    try {
      await window.desktopApp.openAgentsDirectory();
    } catch {
      showMessage('error', '打开智能体目录失败');
    }
  }

  async function handleCreate() {
    setEditingAgent(createBlankAgent());
    setIsCreating(true);
  }

  async function handleEdit(agent: AgentProfileListItem) {
    try {
      const detail = await window.desktopApp.getAgent(agent.id);
      if (!detail) {
        showMessage('error', '未找到该智能体');
        return;
      }

      await Promise.all([loadMcpServers(), loadSkills()]);
      setEditingAgent(detail);
      setIsCreating(false);
    } catch {
      showMessage('error', '加载智能体详情失败');
    }
  }

  useEffect(() => {
    if (loading || !initialAgentId || initialEditRequestedRef.current === initialAgentId) {
      return;
    }

    initialEditRequestedRef.current = initialAgentId;
    const agent = agents.find((item) => item.id === initialAgentId);
    if (!agent) {
      showMessage('error', '未找到该智能体');
      return;
    }

    void handleEdit(agent);
  }, [agents, initialAgentId, loading]);

  async function handleDelete(agent: AgentProfileListItem) {
    let referencedWorkflows: { title: string }[] = [];
    try {
      referencedWorkflows = await window.desktopApp.listWorkflowsByAgent(agent.id);
    } catch {
      // 查询引用失败不阻断删除
      referencedWorkflows = [];
    }

    let message = `确定要删除智能体“${agent.title}”吗？\n\n这将删除对应本地文件。`;
    if (referencedWorkflows.length > 0) {
      const titles = referencedWorkflows.map((item) => item.title).join('、');
      message = `智能体“${agent.title}”已被以下工作流引用：\n${titles}\n\n删除后相关节点将失效。确定要继续删除吗？\n\n这将删除对应本地文件。`;
    }

    if (!confirm(message)) {
      return;
    }

    try {
      const result = await window.desktopApp.deleteAgent(agent.id);
      if (!result.ok) {
        showMessage('error', result.error ?? '删除智能体失败');
        return;
      }

      showMessage('success', `智能体“${agent.title}”已删除`);
      await loadAgents();
    } catch {
      showMessage('error', '删除智能体失败');
    }
  }

  async function handleSave(payload: AgentSavePayload) {
    const result = isCreating
      ? await window.desktopApp.createAgent({
        title: payload.title,
        description: payload.description,
        model: payload.model,
        avatarColor: payload.avatarColor,
        skillNames: payload.skillNames,
        uiDslEnabled: payload.uiDslEnabled,
        uiHtmlEnabled: payload.uiHtmlEnabled,
        content: payload.content,
        mcp: {
          enabledServerNames: payload.enabledServerNames,
        },
      })
      : payload.id
        ? await window.desktopApp.updateAgent({
          id: payload.id,
          title: payload.title,
          description: payload.description,
          model: payload.model,
          avatarColor: payload.avatarColor,
          skillNames: payload.skillNames,
          uiDslEnabled: payload.uiDslEnabled,
          uiHtmlEnabled: payload.uiHtmlEnabled,
          content: payload.content,
          mcp: {
            enabledServerNames: payload.enabledServerNames,
          },
        })
        : null;

    if (!result?.ok) {
      const errorMessage = result?.error ?? (isCreating ? '创建智能体失败' : '更新智能体失败');
      showMessage('error', errorMessage);
      setEditingAgent(null);
      setIsCreating(false);
      throw new Error(errorMessage);
    }


    if (result.data) {
      const savedListItem = toAgentListItem(result.data);
      setAgents((current) => {
        const nextAgents = upsertAgentListItem(current, savedListItem);
        onAgentsChanged?.(nextAgents);
        return nextAgents;
      });
    }

    showMessage('success', isCreating ? '智能体创建成功' : '智能体更新成功');
    setEditingAgent(null);
    setIsCreating(false);
  }

  /** 编辑已有智能体时「改即存」：持久化并同步列表，但不关闭编辑器。失败抛出以便编辑器内联提示。 */
  async function handleAutoSave(payload: AgentSavePayload) {
    if (!payload.id) {
      return;
    }

    const result = await window.desktopApp.updateAgent({
      id: payload.id,
      title: payload.title,
      description: payload.description,
      model: payload.model,
      avatarColor: payload.avatarColor,
      skillNames: payload.skillNames,
      uiDslEnabled: payload.uiDslEnabled,
      uiHtmlEnabled: payload.uiHtmlEnabled,
      content: payload.content,
      mcp: {
        enabledServerNames: payload.enabledServerNames,
      },
    });

    if (!result?.ok) {
      const errorMessage = result?.error ?? '更新智能体失败';
      showMessage('error', errorMessage);
      throw new Error(errorMessage);
    }

    if (result.data) {
      const savedListItem = toAgentListItem(result.data);
      setAgents((current) => {
        const nextAgents = upsertAgentListItem(current, savedListItem);
        onAgentsChanged?.(nextAgents);
        return nextAgents;
      });
    }

    showMessage('success', '已保存');
  }

  function handleCancelEdit() {
    setEditingAgent(null);
    setIsCreating(false);
  }

  return (
    <div className="agents-panel settings-surface-card">
      <div className="skills-header settings-page-header">
        <div>
          <h2>智能体管理</h2>
          <p className="settings-description">管理本地智能体资料、系统提示词、关联 Skills 与 MCP 服务。</p>
        </div>
        <div className="skills-header-actions">
          <button className="ghost-button" type="button" onClick={() => void handleOpenDirectory()}>
            <FolderOpen size={15} strokeWidth={2} aria-hidden="true" />
            <span>打开目录</span>
          </button>
          {!editingAgent ? (
            <button className="create-button" type="button" onClick={() => void handleCreate()}>
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              <span>创建智能体</span>
            </button>
          ) : null}
        </div>
      </div>

      {message ? <div className={`skills-message skills-message-${message.type}`}>{message.text}</div> : null}

      <div className="skills-content">
        {editingAgent ? (
          <AgentEditor
            agent={editingAgent}
            isCreating={isCreating}
            availableSkills={availableSkills}
            availableMcpServers={availableMcpServers}
            onSave={handleSave}
            onAutoSave={handleAutoSave}
            onCancel={handleCancelEdit}
          />
        ) : (
          <>
            {loading ? (
              <div className="skills-loading">加载中...</div>
            ) : agents.length === 0 ? (
              <div className="skills-empty">
                <p>暂无本地智能体</p>
                <p>点击右上角按钮创建智能体，或手动向目录写入 `AGENT.md` 与 `agent.json`。</p>
              </div>
            ) : (
              <div className="skills-list agent-list-settings">
                {agents.map((agent) => (
                  <div key={agent.id} className="skill-item agent-settings-item">
                    <span className={`agent-avatar agent-avatar-settings agent-avatar-${agent.avatarColor}`} aria-hidden="true">
                      {getAgentInitial(agent.title)}
                    </span>
                    <div className="skill-info">
                      <h3 className="skill-name agent-title">{agent.title}</h3>
                      <p className="skill-description agent-settings-summary">{agent.description || '未填写智能体描述'}</p>
                      <div className="agent-settings-meta-row">
                        <span>模型: {agent.model}</span>
                        <span>Skills: {agent.skillNames.length}</span>
                        <span>MCP: {agent.mcp.enabledServerNames.length}</span>
                      </div>
                    </div>
                    <div className="skill-actions skill-actions-icon-only">
                      <button className="edit-button icon-button" type="button" onClick={() => void handleEdit(agent)} aria-label={`编辑 ${agent.title}`}>
                        <FilePenLine size={15} strokeWidth={2} />
                      </button>
                      {agent.id === DEFAULT_AGENT_ID ? null : (
                        <button className="delete-button icon-button" type="button" onClick={() => void handleDelete(agent)} aria-label={`删除 ${agent.title}`}>
                          <Trash2 size={15} strokeWidth={2} />
                        </button>
                      )}
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
