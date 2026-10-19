import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Bot, ChevronDown, Code2, FolderCode, MessagesSquare, Pencil, Plus, Search, Settings, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { BotMarkIcon } from './BotMarkIcon';
import { DEFAULT_AGENT_ID, type AgentProfileListItem } from '../../../shared/agent-profile';
import { buildCodeConversationScope, type CodeProjectListItem } from '../../../shared/code-project';
import type { ConversationListItem, ConversationUnreadSummary } from '../../../shared/conversation';
import type { WorkflowDefinitionListItem } from '../../../shared/workflow-definition';

export type SidebarTab = 'agents' | 'workflows' | 'code';

type SidebarPanelProps = {
  agents: AgentProfileListItem[];
  selectedAgentId: string | null;
  workflows: WorkflowDefinitionListItem[];
  selectedWorkflowType: 'debate' | 'deep_research' | 'custom';
  selectedCustomWorkflowId: string | null;
  codeProjects: CodeProjectListItem[];
  selectedCodeProjectId: string | null;
  mode: 'chat' | 'workflow' | 'code';
  activeTab: SidebarTab;
  /** 当前展开会话列表的 scope（智能体 id 或 code:{projectId}），null 表示全部收起。 */
  expandedScopeKey: string | null;
  /** 展开 scope 对应的会话列表（按最近更新倒序）。 */
  conversations: ConversationListItem[];
  /** 按 scope 聚合的未读数，用于智能体 / 代码工程条目上的未读徽标。 */
  unreadSummary: ConversationUnreadSummary;
  activeConversationId: string | null;
  isRunning: boolean;
  /** 正在后台运行的会话 id 集合。运行中的会话禁止删除（删除按钮禁用）。 */
  runningConversationIds: string[];
  isCreatingConversation: boolean;
  onTabChange: (tab: SidebarTab) => void;
  onSelectAgent: (agentId: string | null) => void;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (conversationId: string, conversationTitle: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onCreateAgent: () => void;
  onOpenAgentSettings: (agentId: string) => void;
  onSelectBuiltInWorkflow: (type: 'debate' | 'deep_research') => void;
  onSelectCustomWorkflow: (workflowId: string) => void;
  onCreateWorkflow: () => void;
  onSelectCodeProject: (projectId: string) => void;
  onImportCodeProject: () => void;
  onRemoveCodeProject: (projectId: string, projectName: string) => void;
  onOpenSettings: () => void;
};

function getAgentInitial(title: string) {
  return title.trim().charAt(0).toUpperCase() || '?';
}

function formatConversationUpdatedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const now = new Date();
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  if (date.toDateString() === now.toDateString()) {
    return `${hh}:${mm}`;
  }
  return `${date.getMonth() + 1}-${date.getDate()} ${hh}:${mm}`;
}

function formatWorkflowNodePreview(agentTitles: string[]) {
  if (agentTitles.length === 0) {
    return '节点：未配置';
  }
  return `节点：${agentTitles.join(' → ')}`;
}

/** 未读徽标：定时任务把结果追加进会话后出现，打开该会话即清零。 */
function UnreadBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) {
    return null;
  }

  return (
    <span className="app-unread-badge" title={`${label}有 ${count} 条未读消息`} aria-label={`${label}有 ${count} 条未读消息`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}


export function SidebarPanel({
  agents,
  selectedAgentId,
  workflows,
  selectedWorkflowType,
  selectedCustomWorkflowId,
  codeProjects,
  selectedCodeProjectId,
  mode,
  activeTab,
  expandedScopeKey,
  conversations,
  unreadSummary,
  activeConversationId,
  isRunning,
  runningConversationIds,
  isCreatingConversation,
  onTabChange,
  onSelectAgent,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  onCreateAgent,
  onOpenAgentSettings,
  onSelectBuiltInWorkflow,
  onSelectCustomWorkflow,
  onCreateWorkflow,
  onSelectCodeProject,
  onImportCodeProject,
  onRemoveCodeProject,
  onOpenSettings,
}: SidebarPanelProps) {
  const customAgents = agents.filter((agent) => agent.id !== DEFAULT_AGENT_ID);
  const defaultAgent = agents.find((agent) => agent.id === DEFAULT_AGENT_ID) ?? null;

  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingTitleDraft, setEditingTitleDraft] = useState('');
  /** Esc 取消后 input 可能仍触发一次 blur，用标记避免把取消误提交成重命名。 */
  const editCancelledRef = useRef(false);
  /** Code 工程右键菜单：hover 删除按钮与会话下拉按钮重叠，删除入口改走右键。 */
  const [projectMenuState, setProjectMenuState] = useState<{ projectId: string; projectName: string; x: number; y: number } | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);

  // 菜单打开期间监听全局点击/Esc，点击菜单外部或按 Esc 都关闭
  useEffect(() => {
    if (!projectMenuState) {
      return;
    }

    function handlePointerDown(event: globalThis.MouseEvent) {
      // 菜单内部的 mousedown 不能关菜单：否则元素先被卸载，click 落不到菜单项上
      if (projectMenuRef.current && event.target instanceof Node && projectMenuRef.current.contains(event.target)) {
        return;
      }

      setProjectMenuState(null);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setProjectMenuState(null);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [projectMenuState]);

  function openProjectMenu(event: ReactMouseEvent<HTMLDivElement>, project: CodeProjectListItem) {
    event.preventDefault();
    // 简单视口收拢：菜单约 180x40，越界时向左/向上收
    const x = Math.min(event.clientX, window.innerWidth - 190);
    const y = Math.min(event.clientY, window.innerHeight - 60);
    setProjectMenuState({ projectId: project.id, projectName: project.name, x, y });
  }

  // 编辑中的会话被移出列表（被删除/切换 scope）时退出编辑态
  useEffect(() => {
    if (editingConversationId && !conversations.some((item) => item.id === editingConversationId)) {
      setEditingConversationId(null);
    }
  }, [conversations, editingConversationId]);

  function beginConversationEdit(conversationId: string, currentTitle: string) {
    editCancelledRef.current = false;
    setEditingConversationId(conversationId);
    setEditingTitleDraft(currentTitle);
  }

  function cancelConversationEdit() {
    editCancelledRef.current = true;
    setEditingConversationId(null);
  }

  function commitConversationEdit(conversationId: string) {
    if (editCancelledRef.current) {
      editCancelledRef.current = false;
      setEditingConversationId(null);
      return;
    }
    const nextTitle = editingTitleDraft.trim();
    const currentTitle = conversations.find((item) => item.id === conversationId)?.title ?? '';
    setEditingConversationId(null);
    if (!nextTitle || nextTitle === currentTitle) {
      return;
    }
    onRenameConversation(conversationId, nextTitle);
  }
  const builtInWorkflows: Array<{ type: 'debate' | 'deep_research'; label: string; description: string; icon: typeof MessagesSquare }> = [
    { type: 'debate', label: '辩论模式', description: '多智能体对抗辩论', icon: MessagesSquare },
    { type: 'deep_research', label: '深度调研', description: '多阶段深度研究', icon: Search },
  ];

  /** 渲染某个 scope 展开后的会话列表；未展开返回 null。末项固定为“新增会话”。 */
  function renderConversationList(scopeKey: string) {
    if (expandedScopeKey !== scopeKey) {
      return null;
    }

    return (
      <div className="app-conversation-list">
        {conversations.length === 0 ? (
          <div className="app-conversation-empty">暂无会话</div>
        ) : (
          conversations.map((conversation) => {
            const isActive = conversation.id === activeConversationId;
            const isEditing = conversation.id === editingConversationId;
            const isConversationRunning = runningConversationIds.includes(conversation.id);
            return (
              <div
                key={conversation.id}
                role="button"
                tabIndex={0}
                className={`app-conversation-item${isActive ? ' app-conversation-item-active' : ''}`}
                onClick={() => {
                  if (!isEditing) {
                    onSelectConversation(conversation.id);
                  }
                }}
                onKeyDown={(event) => {
                  if (isEditing || (event.key !== 'Enter' && event.key !== ' ')) {
                    return;
                  }
                  event.preventDefault();
                  onSelectConversation(conversation.id);
                }}
                title={conversation.title}
              >
                {isEditing ? (
                  <input
                    className="app-conversation-item-input"
                    value={editingTitleDraft}
                    autoFocus
                    maxLength={100}
                    spellCheck={false}
                    onChange={(event) => setEditingTitleDraft(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => commitConversationEdit(conversation.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitConversationEdit(conversation.id);
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelConversationEdit();
                      }
                    }}
                  />
                ) : (
                  <span
                    className="app-conversation-item-title"
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      beginConversationEdit(conversation.id, conversation.title);
                    }}
                  >
                    {conversation.title}
                  </span>
                )}
                {isActive ? (
                  <span className="app-conversation-item-meta">
                    {conversation.messageCount} 条 · {formatConversationUpdatedAt(conversation.updatedAt)}
                  </span>
                ) : null}
                <UnreadBadge count={conversation.unreadCount} label={`会话「${conversation.title}」`} />
                {isEditing ? null : (
                  <>
                    <button
                      type="button"
                      className="app-conversation-item-edit"
                      aria-label={`重命名会话 ${conversation.title}`}
                      title="重命名会话"
                      onClick={(event) => {
                        event.stopPropagation();
                        beginConversationEdit(conversation.id, conversation.title);
                      }}
                    >
                      <Pencil size={12} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="app-conversation-item-remove"
                      aria-label={`删除会话 ${conversation.title}`}
                      title={isConversationRunning ? '该会话正在执行，结束后才能删除' : '删除该会话及其聊天记录'}
                      disabled={isConversationRunning}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteConversation(conversation.id, conversation.title);
                      }}
                    >
                      <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
        <button
          type="button"
          className="app-conversation-add"
          onClick={onCreateConversation}
          disabled={isCreatingConversation}
          title="为当前智能体新增一个会话"
        >
          <Plus size={13} strokeWidth={2} aria-hidden="true" />
          <span>{isCreatingConversation ? '正在创建...' : '新增会话'}</span>
        </button>
      </div>
    );
  }

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar-brand">
        <div className="app-sidebar-brand-mark" aria-hidden="true">
          <BotMarkIcon size={22} />
        </div>
        <div className="app-sidebar-brand-copy">
          <h1>AI 小助手</h1>
          <p>桌面智能体控制台</p>
        </div>
      </div>

      <div className="app-sidebar-tabs" role="tablist" aria-label="侧边栏视图切换">
        <button
          type="button"
          className={`app-sidebar-tab${activeTab === 'agents' ? ' app-sidebar-tab-active' : ''}`}
          onClick={() => onTabChange('agents')}
        >
          <Bot size={15} strokeWidth={2} aria-hidden="true" />
          <span>智能体</span>
        </button>
        <button
          type="button"
          className={`app-sidebar-tab${activeTab === 'workflows' ? ' app-sidebar-tab-active' : ''}`}
          onClick={() => onTabChange('workflows')}
        >
          <WorkflowIcon size={15} strokeWidth={2} aria-hidden="true" />
          <span>工作流</span>
        </button>
        <button
          type="button"
          className={`app-sidebar-tab${activeTab === 'code' ? ' app-sidebar-tab-active' : ''}`}
          onClick={() => onTabChange('code')}
        >
          <Code2 size={15} strokeWidth={2} aria-hidden="true" />
          <span>Code</span>
        </button>
      </div>

      <div className="app-sidebar-body">
        {activeTab === 'agents' ? (
          <div className="app-sidebar-section">
            <div className="app-sidebar-section-title">当前可用智能体</div>
            <div className="app-agent-list">
              <div className="app-agent-entry">
                <button
                  type="button"
                  className={`app-agent-item app-agent-item-with-avatar${mode === 'chat' && (selectedAgentId === null || selectedAgentId === DEFAULT_AGENT_ID) ? ' app-agent-item-active' : ''}`}
                  onClick={() => onSelectAgent(DEFAULT_AGENT_ID)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onOpenAgentSettings(DEFAULT_AGENT_ID);
                  }}
                  title={defaultAgent?.description || '使用全局默认配置执行请求'}
                >
                  <span className={`agent-avatar agent-avatar-sidebar ${defaultAgent ? `agent-avatar-${defaultAgent.avatarColor}` : 'agent-avatar-default'}`} aria-hidden="true">
                    {defaultAgent ? getAgentInitial(defaultAgent.title) : '默'}
                  </span>
                  <span className="app-agent-item-copy">
                    <span className="app-agent-item-title">{defaultAgent?.title ?? '默认智能体'}</span>
                    <span className="app-agent-item-meta">{defaultAgent?.description || '使用全局默认配置执行请求'}</span>
                  </span>
                  <UnreadBadge count={unreadSummary[DEFAULT_AGENT_ID] ?? 0} label={defaultAgent?.title ?? '默认智能体'} />
                  <ChevronDown
                    className={`app-agent-item-chevron${expandedScopeKey === DEFAULT_AGENT_ID ? ' app-agent-item-chevron-expanded' : ''}`}
                    size={14}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </button>
                {renderConversationList(DEFAULT_AGENT_ID)}
              </div>
              {customAgents.length === 0 ? (
                <div className="app-sidebar-empty">暂无自定义智能体，点击下方按钮新增。</div>
              ) : (
                customAgents.map((agent) => (
                  <div className="app-agent-entry" key={agent.id}>
                    <button
                      type="button"
                      className={`app-agent-item app-agent-item-with-avatar${mode === 'chat' && selectedAgentId === agent.id ? ' app-agent-item-active' : ''}`}
                      onClick={() => onSelectAgent(agent.id)}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        onOpenAgentSettings(agent.id);
                      }}
                      title={agent.title}
                    >
                      <span className={`agent-avatar agent-avatar-sidebar agent-avatar-${agent.avatarColor}`} aria-hidden="true">
                        {getAgentInitial(agent.title)}
                      </span>
                      <span className="app-agent-item-copy">
                        <span className="app-agent-item-title">{agent.title}</span>
                        <span className="app-agent-item-meta">{agent.description || ''}</span>
                      </span>
                      <UnreadBadge count={unreadSummary[agent.id] ?? 0} label={agent.title} />
                      <ChevronDown
                        className={`app-agent-item-chevron${expandedScopeKey === agent.id ? ' app-agent-item-chevron-expanded' : ''}`}
                        size={14}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </button>
                    {renderConversationList(agent.id)}
                  </div>
                ))
              )}
              <button
                type="button"
                className="app-workflow-item app-workflow-item-add"
                onClick={onCreateAgent}
                title="创建新的智能体"
              >
                <span className="app-workflow-item-icon" aria-hidden="true">
                  <Plus size={16} strokeWidth={2} />
                </span>
                <span className="app-workflow-item-copy">
                  <span className="app-workflow-item-title">新增智能体</span>
                  <span className="app-workflow-item-meta">跳转到设置中的创建页</span>
                </span>
              </button>
            </div>
          </div>
        ) : activeTab === 'workflows' ? (
          <div className="app-sidebar-section">
            <div className="app-sidebar-section-title">内置模式</div>
            <div className="app-workflow-list">
              {builtInWorkflows.map((item) => {
                const Icon = item.icon;
                const isActive = mode === 'workflow'
                  && selectedWorkflowType === item.type
                  && selectedCustomWorkflowId === null;
                return (
                  <button
                    key={item.type}
                    type="button"
                    className={`app-workflow-item${isActive ? ' app-workflow-item-active' : ''}`}
                    onClick={() => onSelectBuiltInWorkflow(item.type)}
                  >
                    <span className="app-workflow-item-icon" aria-hidden="true">
                      <Icon size={16} strokeWidth={2} />
                    </span>
                    <span className="app-workflow-item-copy">
                      <span className="app-workflow-item-title">{item.label}</span>
                      <span className="app-workflow-item-meta">{item.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="app-sidebar-section-title app-sidebar-section-title-secondary">自定义工作流</div>
            <div className="app-workflow-list">
              {workflows.length === 0 ? (
                <div className="app-sidebar-empty">暂无自定义工作流，点击下方按钮新增。</div>
              ) : (
                workflows.map((workflow) => {
                  const isActive = mode === 'workflow'
                    && selectedWorkflowType === 'custom'
                    && selectedCustomWorkflowId === workflow.id;
                  return (
                    <button
                      key={workflow.id}
                      type="button"
                      className={`app-workflow-item${isActive ? ' app-workflow-item-active' : ''}`}
                      onClick={() => onSelectCustomWorkflow(workflow.id)}
                      title={workflow.description || workflow.title}
                    >
                      <span className="app-workflow-item-icon" aria-hidden="true">
                        <WorkflowIcon size={16} strokeWidth={2} />
                      </span>
                      <span className="app-workflow-item-copy">
                        <span className="app-workflow-item-title">{workflow.title}</span>
                        <span className="app-workflow-item-meta">{formatWorkflowNodePreview(workflow.agentTitles)}</span>
                      </span>
                    </button>
                  );
                })
              )}
              <button
                type="button"
                className="app-workflow-item app-workflow-item-add"
                onClick={onCreateWorkflow}
                title="创建新的自定义工作流"
              >
                <span className="app-workflow-item-icon" aria-hidden="true">
                  <Plus size={16} strokeWidth={2} />
                </span>
                <span className="app-workflow-item-copy">
                  <span className="app-workflow-item-title">新增工作流</span>
                  <span className="app-workflow-item-meta">跳转到设置中的创建页</span>
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="app-sidebar-section">
            <div className="app-sidebar-section-title">已打开的工程</div>
            <div className="app-workflow-list">
              {codeProjects.map((project) => {
                const isActive = mode === 'code' && selectedCodeProjectId === project.id;
                const scopeKey = buildCodeConversationScope(project.id);
                return (
                  <div className="app-agent-entry" key={project.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      className={`app-workflow-item${isActive ? ' app-workflow-item-active' : ''}`}
                      onClick={() => onSelectCodeProject(project.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectCodeProject(project.id);
                        }
                      }}
                      onContextMenu={(event) => openProjectMenu(event, project)}
                      title={project.rootPath}
                    >
                      <span className="app-workflow-item-icon" aria-hidden="true">
                        <FolderCode size={16} strokeWidth={2} />
                      </span>
                      <span className="app-workflow-item-copy">
                        <span className="app-workflow-item-title">{project.name}</span>
                        <span className="app-workflow-item-meta app-workflow-item-meta-path">{project.rootPath}</span>
                      </span>
                      <UnreadBadge count={unreadSummary[scopeKey] ?? 0} label={project.name} />
                      <ChevronDown
                        className={`app-agent-item-chevron${expandedScopeKey === scopeKey ? ' app-agent-item-chevron-expanded' : ''}`}
                        size={14}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </div>
                    {renderConversationList(scopeKey)}
                  </div>
                );
              })}
              <button
                type="button"
                className="app-workflow-item app-workflow-item-add"
                onClick={onImportCodeProject}
                title="导入新的代码工程"
              >
                <span className="app-workflow-item-icon" aria-hidden="true">
                  <Plus size={16} strokeWidth={2} />
                </span>
                <span className="app-workflow-item-copy">
                  <span className="app-workflow-item-title">导入工程</span>
                  <span className="app-workflow-item-meta">选择本地代码目录</span>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="app-sidebar-footer">
        <button className="ghost-button sidebar-settings-button" type="button" onClick={onOpenSettings}>
          <Settings size={15} strokeWidth={2} aria-hidden="true" />
          <span>设置与管理</span>
        </button>
      </div>

      {projectMenuState ? (
        <div
          ref={projectMenuRef}
          className="message-context-menu"
          style={{ top: projectMenuState.y, left: projectMenuState.x }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="message-context-menu-item"
            type="button"
            onClick={() => {
              setProjectMenuState(null);
              onRemoveCodeProject(projectMenuState.projectId, projectMenuState.projectName);
            }}
          >
            移除工程
          </button>
        </div>
      ) : null}
    </aside>
  );
}
