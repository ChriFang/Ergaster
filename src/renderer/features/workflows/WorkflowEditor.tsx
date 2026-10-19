import '@xyflow/react/dist/style.css';
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, applyNodeChanges, type Node, type NodeProps, type OnNodesChange } from '@xyflow/react';
import { ArrowDown, ArrowUp, Play, Plus, Trash2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { AgentProfileListItem } from '../../../shared/agent-profile';
import type { WorkflowDefinition, WorkflowNode } from '../../../shared/workflow-definition';

type WorkflowAgentData = {
  agentId: string;
  label: string;
  inputTemplate: string;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
};

type WorkflowEditorContextValue = {
  agents: AgentProfileListItem[];
  agentMap: Map<string, AgentProfileListItem>;
  updateNode: (id: string, patch: Partial<Omit<WorkflowAgentData, 'index' | 'canMoveUp' | 'canMoveDown'>>) => void;
  deleteNode: (id: string) => void;
  moveNode: (id: string, direction: 'up' | 'down') => void;
};

const WorkflowEditorContext = createContext<WorkflowEditorContextValue | null>(null);

const NODE_WIDTH = 320;
const EXPANDED_NODE_HEIGHT = 220;
const COLLAPSED_NODE_HEIGHT = 44;
const NODE_GAP_Y = 60;

function defaultPosition(index: number) {
  return { x: 0, y: index * (COLLAPSED_NODE_HEIGHT + NODE_GAP_Y) };
}

function WorkflowAgentNode({ data, id }: NodeProps) {
  const nodeData = data as WorkflowAgentData;
  const ctx = useContext(WorkflowEditorContext);
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

  if (!ctx) {
    return null;
  }

  const agent = nodeData.agentId ? ctx.agentMap.get(nodeData.agentId) ?? null : null;
  const invalid = Boolean(nodeData.agentId) && !agent;
  const agentTitle = agent?.title ?? '';
  const displayTitle = nodeData.label.trim() || agentTitle || '未选择智能体';

  if (expanded) {
    return (
      <div
        className={`workflow-node-card workflow-node-card-expanded${invalid ? ' workflow-node-card-invalid' : ''}`}
        onDoubleClick={toggleExpanded}
        title="双击收起"
      >
        <Handle type="target" position={Position.Top} className="workflow-node-handle-rf" />
        <div className="workflow-node-card-header">
          <span className="workflow-node-card-index">节点 {nodeData.index + 1}</span>
          <div className="workflow-node-card-actions">
            <button
              type="button"
              className="icon-button nodrag"
              onClick={() => ctx.moveNode(id, 'up')}
              disabled={!nodeData.canMoveUp}
              aria-label="上移"
            >
              <ArrowUp size={13} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="icon-button nodrag"
              onClick={() => ctx.moveNode(id, 'down')}
              disabled={!nodeData.canMoveDown}
              aria-label="下移"
            >
              <ArrowDown size={13} strokeWidth={2} />
            </button>
            <button type="button" className="delete-button icon-button nodrag" onClick={() => { if (confirm('确定要删除该节点吗？')) ctx.deleteNode(id); }} aria-label="删除节点">
              <Trash2 size={13} strokeWidth={2} />
            </button>
          </div>
        </div>

        <label className="field workflow-node-field">
          <span>智能体</span>
          <select
            className="nodrag"
            value={nodeData.agentId}
            onChange={(event) => ctx.updateNode(id, { agentId: event.target.value })}
          >
            <option value="">请选择智能体</option>
            {ctx.agents.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}{candidate.model ? ` · ${candidate.model}` : ''}
              </option>
            ))}
          </select>
        </label>

        {invalid ? <div className="workflow-node-card-warning">该智能体已失效，请重新选择。</div> : null}

        <label className="field workflow-node-field">
          <span>节点名称（可选）</span>
          <input
            className="nodrag"
            type="text"
            value={nodeData.label}
            onChange={(event) => ctx.updateNode(id, { label: event.target.value })}
            placeholder={agent?.title ?? '默认使用智能体名称'}
          />
        </label>

        <label className="field workflow-node-field">
          <span>输入模板（可选，支持 {'{{input}}'}）</span>
          <textarea
            className="workflow-node-template nodrag"
            value={nodeData.inputTemplate}
            onChange={(event) => ctx.updateNode(id, { inputTemplate: event.target.value })}
            placeholder="留空则直接使用上游输出；可用 {{input}} 引用上游输出"
            spellCheck={false}
            rows={4}
          />
        </label>

        <Handle type="source" position={Position.Bottom} className="workflow-node-handle-rf" />
      </div>
    );
  }

  return (
    <div
      className={`workflow-node-card workflow-node-card-collapsed${invalid ? ' workflow-node-card-invalid' : ''}`}
      onDoubleClick={toggleExpanded}
      title="双击展开编辑"
    >
      <Handle type="target" position={Position.Top} className="workflow-node-handle-rf" />
      <div className="workflow-node-card-collapsed-row">
        <div className="workflow-node-card-collapsed-info">
          <span className="workflow-node-card-index">节点 {nodeData.index + 1}</span>
          <span className="workflow-node-card-collapsed-title">{displayTitle}</span>
        </div>
        <div className="workflow-node-card-collapsed-actions nodrag" title="">
          <button
            type="button"
            className="icon-button"
            onClick={() => ctx.moveNode(id, 'up')}
            disabled={!nodeData.canMoveUp}
            aria-label="上移"
            title="上移"
          >
            <ArrowUp size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => ctx.moveNode(id, 'down')}
            disabled={!nodeData.canMoveDown}
            aria-label="下移"
            title="下移"
          >
            <ArrowDown size={13} strokeWidth={2} />
          </button>
          <button type="button" className="delete-button icon-button" onClick={() => { if (confirm('确定要删除该节点吗？')) ctx.deleteNode(id); }} aria-label="删除节点" title="删除节点">
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>
        <Handle type="source" position={Position.Bottom} className="workflow-node-handle-rf" />
      </div>
    </div>
  );
}

const nodeTypes = { workflowAgent: WorkflowAgentNode };

type Props = {
  workflow: WorkflowDefinition | null;
  isCreating: boolean;
  agents: AgentProfileListItem[];
  onSave: (payload: { id?: string; title: string; description: string; nodes: WorkflowNode[] }) => Promise<void>;
  onCancel: () => void;
  onRequestRun: (workflowId: string) => void;
};

function toFlowNodes(nodes: WorkflowNode[]): Node<WorkflowAgentData>[] {
  return nodes.map((node, index) => ({
    id: node.id,
    type: 'workflowAgent',
    position: node.position,
    data: {
      agentId: node.agentId,
      label: node.label ?? '',
      inputTemplate: node.inputTemplate ?? '',
      index,
      canMoveUp: index > 0,
      canMoveDown: index < nodes.length - 1,
    },
    draggable: true,
  }));
}

function flowNodesToDefinition(nodes: Node<WorkflowAgentData>[]): WorkflowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    agentId: node.data.agentId,
    label: node.data.label.trim() || undefined,
    inputTemplate: node.data.inputTemplate.trim() || undefined,
    position: { x: node.position.x, y: node.position.y },
  }));
}

export function WorkflowEditor({ workflow, isCreating, agents, onSave, onCancel, onRequestRun }: Props) {
  const [title, setTitle] = useState(workflow?.title ?? '');
  const [description, setDescription] = useState(workflow?.description ?? '');
  const [nodes, setNodes] = useState<Node<WorkflowAgentData>[]>(() => toFlowNodes(workflow?.nodes ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const nodeCountRef = useRef(workflow?.nodes?.length ?? 0);

  const agentMap = useMemo(() => {
    const map = new Map<string, AgentProfileListItem>();
    for (const agent of agents) {
      map.set(agent.id, agent);
    }
    return map;
  }, [agents]);

  const edges = useMemo(() => {
    const result: { id: string; source: string; target: string; type: string }[] = [];
    for (let index = 0; index < nodes.length - 1; index += 1) {
      result.push({
        id: `edge-${nodes[index].id}-${nodes[index + 1].id}`,
        source: nodes[index].id,
        target: nodes[index + 1].id,
        type: 'smoothstep',
      });
    }
    return result;
  }, [nodes]);

  const refreshIndices = useCallback((list: Node<WorkflowAgentData>[]): Node<WorkflowAgentData>[] => {
    return list.map((node, index) => ({
      ...node,
      data: {
        ...node.data,
        index,
        canMoveUp: index > 0,
        canMoveDown: index < list.length - 1,
      },
    }));
  }, []);

  const onNodesChange: OnNodesChange<Node<WorkflowAgentData>> = useCallback((changes) => {
    setNodes((current) => applyNodeChanges(changes, current) as Node<WorkflowAgentData>[]);
  }, []);

  const updateNode = useCallback((id: string, patch: Partial<Omit<WorkflowAgentData, 'index' | 'canMoveUp' | 'canMoveDown'>>) => {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)));
  }, []);

  const deleteNode = useCallback((id: string) => {
    setNodes((current) => refreshIndices(current.filter((node) => node.id !== id)));
  }, [refreshIndices]);

  const moveNode = useCallback((id: string, direction: 'up' | 'down') => {
    setNodes((current) => {
      const index = current.findIndex((node) => node.id === id);
      if (index < 0) {
        return current;
      }
      const swapWith = direction === 'up' ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= current.length) {
        return current;
      }
      const next = [...current];
      // 交换数组顺序的同时交换坐标，使视觉顺序与执行顺序一致
      const positionA = next[index].position;
      next[index] = { ...next[index], position: next[swapWith].position };
      next[swapWith] = { ...next[swapWith], position: positionA };
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return refreshIndices(next);
    });
  }, [refreshIndices]);

  const handleAddNode = useCallback(() => {
    setNodes((current) => {
      nodeCountRef.current += 1;
      const maxY = current.reduce((max, node) => Math.max(max, node.position.y), 0);
      const newNode: Node<WorkflowAgentData> = {
        id: `node-${Date.now()}-${nodeCountRef.current}`,
        type: 'workflowAgent',
        position: { x: 0, y: current.length === 0 ? 0 : maxY + COLLAPSED_NODE_HEIGHT + NODE_GAP_Y },
        data: {
          agentId: '',
          label: '',
          inputTemplate: '',
          index: current.length,
          canMoveUp: current.length > 0,
          canMoveDown: false,
        },
        draggable: true,
      };
      return refreshIndices([...current, newNode]);
    });
  }, [refreshIndices]);

  function showValidationError(message: string) {
    setError(message);
  }

  async function handleSave() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      showValidationError('请输入工作流名称。');
      return;
    }
    if (nodes.length === 0) {
      showValidationError('请至少添加一个节点。');
      return;
    }
    if (nodes.some((node) => !node.data.agentId)) {
      showValidationError('每个节点都必须选择一个智能体。');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSave({
        ...(workflow?.id ? { id: workflow.id } : {}),
        title: normalizedTitle,
        description: description.trim(),
        nodes: flowNodesToDefinition(nodes),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存工作流失败');
    } finally {
      setSaving(false);
    }
  }

  const contextValue: WorkflowEditorContextValue = useMemo(() => ({
    agents,
    agentMap,
    updateNode,
    deleteNode,
    moveNode,
  }), [agents, agentMap, updateNode, deleteNode, moveNode]);

  const canRun = !isCreating && Boolean(workflow?.id) && nodes.length > 0 && nodes.every((node) => node.data.agentId);

  return (
    <div className="workflow-editor settings-surface-card">
      <div className="editor-header">
        <div>
          <h3>{isCreating ? '创建工作流' : '编辑工作流'}</h3>
        </div>
      </div>

      {error ? <div className="skills-message skills-message-error" role="alert">{error}</div> : null}

      <div className="settings-grid-two-columns">
        <label className="field">
          <span>名称</span>
          <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：会议纪要处理链路" disabled={saving} />
        </label>
      </div>

      <label className="field">
        <span>描述</span>
        <input type="text" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="简要说明这条工作流完成什么任务" disabled={saving} />
      </label>

      <div className="workflow-editor-toolbar">
        <button type="button" className="ghost-button" onClick={handleAddNode} disabled={saving}>
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
          <span>添加节点</span>
        </button>
        <span className="workflow-editor-node-count">共 {nodes.length} 个节点</span>
      </div>

      <WorkflowEditorContext.Provider value={contextValue}>
        <div className="workflow-canvas">
          {nodes.length === 0 ? (
            <div className="workflow-canvas-empty">点击「添加节点」开始编排你的智能体工作流。</div>
          ) : null}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            nodesConnectable={false}
            edgesFocusable={false}
            nodesDraggable
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.4}
            maxZoom={1.5}
            zoomOnDoubleClick={false}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </WorkflowEditorContext.Provider>

      <div className="editor-actions">
        <button type="button" className="save-button" onClick={() => void handleSave()} disabled={saving}>
          {saving ? '保存中...' : '保存工作流'}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => workflow?.id && onRequestRun(workflow.id)}
          disabled={!canRun || saving}
          title={isCreating ? '请先保存工作流后再运行' : ''}
        >
          <Play size={14} strokeWidth={2} aria-hidden="true" />
          <span>运行</span>
        </button>
        <button type="button" className="cancel-button" onClick={onCancel} disabled={saving}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
          <span>取消</span>
        </button>
      </div>
    </div>
  );
}
