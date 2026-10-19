import { FilePenLine, FolderOpen, Play, Plus, Trash2, Workflow as WorkflowIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AgentProfileListItem } from '../../../shared/agent-profile';
import type { WorkflowDefinition, WorkflowDefinitionListItem } from '../../../shared/workflow-definition';
import { WorkflowEditor } from './WorkflowEditor';

type Props = {
  onClose: () => void;
  onRunWorkflow: (workflowId: string, seedPrompt: string) => void;
  startCreating?: boolean;
};

type WorkflowSavePayload = {
  id?: string;
  title: string;
  description: string;
  nodes: WorkflowDefinition['nodes'];
};

function sortWorkflowsByUpdatedAt(items: WorkflowDefinitionListItem[]) {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function upsertWorkflowListItem(items: WorkflowDefinitionListItem[], next: WorkflowDefinition): WorkflowDefinitionListItem[] {
  const item: WorkflowDefinitionListItem = {
    id: next.id,
    title: next.title,
    description: next.description,
    nodeCount: next.nodes.length,
    agentTitles: [],
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
    directoryName: next.directoryName,
  };
  return sortWorkflowsByUpdatedAt([...items.filter((entry) => entry.id !== next.id), item]);
}

function createBlankWorkflow(): WorkflowDefinition {
  return {
    id: '',
    title: '',
    description: '',
    nodes: [],
    createdAt: '',
    updatedAt: '',
    directoryName: '',
    directoryPath: '',
  };
}

export function WorkflowsPanel({ onClose, onRunWorkflow, startCreating }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowDefinitionListItem[]>([]);
  const [agents, setAgents] = useState<AgentProfileListItem[]>([]);
  const [editing, setEditing] = useState<WorkflowDefinition | null>(() => (startCreating ? createBlankWorkflow() : null));
  const [isCreating, setIsCreating] = useState(() => Boolean(startCreating));
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [runTarget, setRunTarget] = useState<WorkflowDefinitionListItem | null>(null);
  const [seedInput, setSeedInput] = useState('');

  useEffect(() => {
    void loadWorkflows();
    void loadAgents();
  }, []);

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 3000);
  }

  async function loadWorkflows() {
    setLoading(true);
    try {
      const result = await window.desktopApp.listWorkflows();
      setWorkflows(result);
    } catch {
      showMessage('error', '加载工作流列表失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadAgents() {
    try {
      const result = await window.desktopApp.listAgents();
      setAgents(result);
    } catch {
      showMessage('error', '加载智能体列表失败');
    }
  }

  async function handleOpenDirectory() {
    try {
      await window.desktopApp.openWorkflowsDirectory();
    } catch {
      showMessage('error', '打开工作流目录失败');
    }
  }

  function handleCreate() {
    setEditing(createBlankWorkflow());
    setIsCreating(true);
  }

  async function handleEdit(workflow: WorkflowDefinitionListItem) {
    try {
      const detail = await window.desktopApp.getWorkflow(workflow.id);
      if (!detail) {
        showMessage('error', '未找到该工作流');
        return;
      }
      await loadAgents();
      setEditing(detail);
      setIsCreating(false);
    } catch {
      showMessage('error', '加载工作流详情失败');
    }
  }

  async function handleDelete(workflow: WorkflowDefinitionListItem) {
    if (!confirm(`确定要删除工作流“${workflow.title}”吗？\n\n这将删除对应本地文件。`)) {
      return;
    }

    try {
      const result = await window.desktopApp.deleteWorkflow(workflow.id);
      if (!result.ok) {
        showMessage('error', result.error ?? '删除工作流失败');
        return;
      }

      showMessage('success', `工作流“${workflow.title}”已删除`);
      await loadWorkflows();
    } catch {
      showMessage('error', '删除工作流失败');
    }
  }

  async function handleSave(payload: WorkflowSavePayload) {
    const result = isCreating
      ? await window.desktopApp.createWorkflow({
        title: payload.title,
        description: payload.description,
        nodes: payload.nodes,
      })
      : payload.id
        ? await window.desktopApp.updateWorkflow({
          id: payload.id,
          title: payload.title,
          description: payload.description,
          nodes: payload.nodes,
        })
        : null;

    if (!result?.ok) {
      const errorMessage = result?.error ?? (isCreating ? '创建工作流失败' : '更新工作流失败');
      showMessage('error', errorMessage);
      setEditing(null);
      setIsCreating(false);
      throw new Error(errorMessage);
    }

    if (result.data) {
      setWorkflows((current) => upsertWorkflowListItem(current, result.data!));
    }

    showMessage('success', isCreating ? '工作流创建成功' : '工作流更新成功');
    setEditing(null);
    setIsCreating(false);
    await loadWorkflows();
  }

  function handleCancelEdit() {
    setEditing(null);
    setIsCreating(false);
  }

  function handleRequestRun(workflow: WorkflowDefinitionListItem) {
    setRunTarget(workflow);
    setSeedInput('');
  }

  function confirmRun() {
    if (!runTarget) {
      return;
    }
    const seed = seedInput.trim();
    if (!seed) {
      return;
    }
    const target = runTarget;
    setRunTarget(null);
    setSeedInput('');
    onRunWorkflow(target.id, seed);
  }

  function cancelRun() {
    setRunTarget(null);
    setSeedInput('');
  }

  return (
    <div className="workflows-panel settings-surface-card">
      <div className="skills-header settings-page-header">
        <div>
          <h2>WorkFlow 管理</h2>
          <p className="settings-description">编排线性智能体工作流：每个节点对应一个智能体，上一节点输出作为下一节点输入。</p>
        </div>
        <div className="skills-header-actions">
          <button className="ghost-button" type="button" onClick={() => void handleOpenDirectory()}>
            <FolderOpen size={15} strokeWidth={2} aria-hidden="true" />
            <span>打开目录</span>
          </button>
          {!editing ? (
            <button className="create-button" type="button" onClick={() => handleCreate()}>
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              <span>创建工作流</span>
            </button>
          ) : null}
        </div>
      </div>

      {message ? <div className={`skills-message skills-message-${message.type}`}>{message.text}</div> : null}

      <div className="skills-content">
        {editing ? (
          <WorkflowEditor
            workflow={editing}
            isCreating={isCreating}
            agents={agents}
            onSave={handleSave}
            onCancel={handleCancelEdit}
            onRequestRun={(workflowId) => {
              const target = workflows.find((item) => item.id === workflowId) ?? {
                id: workflowId,
                title: editing.title || '未命名工作流',
                description: editing.description,
                nodeCount: editing.nodes.length,
                agentTitles: [],
                createdAt: '',
                updatedAt: '',
                directoryName: editing.directoryName,
              };
              handleRequestRun(target);
            }}
          />
        ) : (
          <>
            {loading ? (
              <div className="skills-loading">加载中...</div>
            ) : workflows.length === 0 ? (
              <div className="skills-empty">
                <p>暂无工作流</p>
                <p>点击右上角按钮创建工作流，或手动向目录写入 `workflow.json`。</p>
              </div>
            ) : (
              <div className="skills-list workflows-list-settings">
                {workflows.map((workflow) => (
                  <div key={workflow.id} className="skill-item workflow-settings-item">
                    <span className="workflow-settings-icon" aria-hidden="true">
                      <WorkflowIcon size={18} strokeWidth={2} />
                    </span>
                    <div className="skill-info">
                      <h3 className="skill-name workflow-title">{workflow.title}</h3>
                      <p className="skill-description workflow-settings-summary">{workflow.description || '未填写工作流描述'}</p>
                      <div className="agent-settings-meta-row">
                        <span>节点数: {workflow.nodeCount}</span>
                        <span>智能体: {workflow.agentTitles.length > 0 ? workflow.agentTitles.join(' → ') : '—'}</span>
                      </div>
                    </div>
                    <div className="skill-actions skill-actions-icon-only">
                      <button className="primary-button icon-button workflow-run-button" type="button" onClick={() => handleRequestRun(workflow)} aria-label={`运行 ${workflow.title}`} disabled={workflow.nodeCount === 0}>
                        <Play size={14} strokeWidth={2} />
                      </button>
                      <button className="edit-button icon-button" type="button" onClick={() => void handleEdit(workflow)} aria-label={`编辑 ${workflow.title}`}>
                        <FilePenLine size={15} strokeWidth={2} />
                      </button>
                      <button className="delete-button icon-button" type="button" onClick={() => void handleDelete(workflow)} aria-label={`删除 ${workflow.title}`}>
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

      {runTarget ? (
        <div className="workflow-seed-overlay" onClick={cancelRun}>
          <div className="workflow-seed-modal settings-surface-card" onClick={(event) => event.stopPropagation()}>
            <div className="workflow-seed-header">
              <h3>运行工作流：{runTarget.title}</h3>
              <button type="button" className="icon-button" onClick={cancelRun} aria-label="取消">
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <p className="workflow-seed-hint">输入本次运行的起始内容，它将作为第一个节点的输入。</p>
            <textarea
              className="agent-textarea workflow-seed-textarea"
              value={seedInput}
              onChange={(event) => setSeedInput(event.target.value)}
              placeholder="例如：请帮我总结这份会议纪要的要点..."
              spellCheck={false}
              autoFocus
            />
            <div className="editor-actions">
              <button type="button" className="primary-button" onClick={confirmRun} disabled={!seedInput.trim()}>
                <Play size={14} strokeWidth={2} aria-hidden="true" />
                <span>开始运行</span>
              </button>
              <button type="button" className="cancel-button" onClick={cancelRun}>
                <X size={14} strokeWidth={2} aria-hidden="true" />
                <span>取消</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
