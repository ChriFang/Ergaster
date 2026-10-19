// 自定义工作流定义：线性智能体链路。
// 一个工作流由有序节点组成，每个节点引用一个智能体，并可带输入模板。
// 运行时上一节点输出作为下一节点输入（首节点输入为 seedPrompt）。

export type WorkflowNodePosition = {
  x: number;
  y: number;
};

export type WorkflowNode = {
  id: string;                 // 节点实例 id（画布内唯一）
  agentId: string;            // 引用的智能体 id
  label?: string;             // 节点显示名（缺省取智能体 title）
  inputTemplate?: string;     // 输入模板，支持 {{input}} 占位符
  position: WorkflowNodePosition; // 画布坐标（React Flow）
};

export type WorkflowDefinition = {
  id: string;
  title: string;
  description: string;
  nodes: WorkflowNode[];      // 线性链：数组顺序即执行顺序
  createdAt: string;
  updatedAt: string;
  directoryName: string;
  directoryPath: string;
};

// 列表项（不含 nodes 详情，轻量）
export type WorkflowDefinitionListItem = {
  id: string;
  title: string;
  description: string;
  nodeCount: number;
  agentTitles: string[];      // 用于列表预览
  createdAt: string;
  updatedAt: string;
  directoryName: string;
};

export type CreateWorkflowDefinitionRequest = {
  title: string;
  description: string;
  nodes: WorkflowNode[];
};

export type UpdateWorkflowDefinitionRequest = {
  id: string;
  title: string;
  description: string;
  nodes: WorkflowNode[];
};

export type WorkflowDefinitionOperationResult = {
  ok: boolean;
  error?: string;
  data?: WorkflowDefinition;
};

// 运行入参
export type CustomWorkflowRunInput = {
  workflowId: string;
  seedPrompt: string;
};

export type CustomWorkflowRunResponse = {
  runId: string;
};
