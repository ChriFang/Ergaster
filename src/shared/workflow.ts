import type { AgentMessage } from './agent';
import type { ToolApprovalMode } from './tools';

export type WorkflowType = 'chat' | 'debate' | 'deep_research' | 'simulation' | 'forecast' | 'custom';

export type WorkflowRunStatus = 'draft' | 'configured' | 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled';

/** 子智能体最大嵌套深度。0 为主智能体，1 为子智能体；子智能体不可再派发。 */
export const maxSubagentDepth = 1;

export type WorkflowSubagentMeta = {
  /** 子智能体实例 id，同一次 fan-out 内唯一。 */
  id: string;
  /** 展示用标签，例如子问题标题。 */
  label: string;
  /** 嵌套深度，主智能体派发出的子智能体为 1。 */
  depth: number;
  /** 派发方的 actorId，用于在 UI 上挂回父节点。 */
  parentActorId?: string;
};

export type WorkflowMessageMeta = {
  workflowId?: string;
  runId?: string;
  workflowType?: WorkflowType;
  stageId?: string;
  stepId?: string;
  actorId?: string;
  actorRole?: string;
  phase?: string;
  artifactType?: string;
  subagent?: WorkflowSubagentMeta;
};

export type WorkflowActor = {
  id: string;
  role: string;
  title: string;
  description?: string;
  status?: WorkflowRunStatus | 'pending';
};

export type WorkflowStage = {
  id: string;
  title: string;
  status: WorkflowRunStatus | 'pending';
  actorIds: string[];
};

export type WorkflowArtifact<TData = unknown> = {
  id: string;
  runId: string;
  workflowType: WorkflowType;
  type: string;
  title: string;
  data: TData;
  createdAt: number;
  stageId?: string;
  actorId?: string;
};

export type WorkflowRunMetrics = {
  /** 运行开始时间。 */
  startedAt: number;
  /** 运行结束时间；仍在运行时为 undefined。 */
  finishedAt?: number;
  /** 累计发出的模型请求次数（含工具循环的每一轮与各子智能体）。 */
  modelRequests: number;
  /** 估算的输入 token，按每次请求实际发送的完整消息累加。 */
  promptTokens: number;
  /** 估算的输出 token，含 reasoning 内容。 */
  completionTokens: number;
  /** promptTokens + completionTokens。 */
  totalTokens: number;
};

export type WorkflowRun = {
  id: string;
  type: WorkflowType;
  title: string;
  status: WorkflowRunStatus;
  currentStageId?: string;
  createdAt: number;
  updatedAt: number;
  inputs: Record<string, unknown>;
  config: Record<string, unknown>;
  actors: WorkflowActor[];
  stages: WorkflowStage[];
  messages: AgentMessage[];
  artifacts: WorkflowArtifact[];
  metrics?: WorkflowRunMetrics;
  error?: string;
};

export type WorkflowStreamEvent = {
  runId: string;
  type: 'run_updated' | 'message_delta' | 'message_done' | 'artifact_created' | 'metrics_updated' | 'completed' | 'failed' | 'cancelled';
  run?: WorkflowRun;
  message?: AgentMessage;
  artifact?: WorkflowArtifact;
  metrics?: WorkflowRunMetrics;
  workflow?: WorkflowMessageMeta;
  streamMessageId?: string;
  deltaReasoningContent?: string;
  deltaContent?: string;
  /** 该流式消息最终对应的角色，用于界面按 tool 折叠工具结果。 */
  role?: 'assistant' | 'tool';
  error?: string;
};

export type DebateTopicType =
  | 'fact_judgement'
  | 'option_selection'
  | 'strategy_decision'
  | 'value_debate'
  | 'software_design'
  | 'product_design';

export type DebateMode = 'debate' | 'compare' | 'review' | 'decision';

export type DebateStanceMode = 'pro_con' | 'multi_option' | 'open_exploration';

export type DebateRubricItem = {
  name: string;
  weight: number;
  description: string;
};

export type DebateConfig = {
  topic: string;
  topicType: DebateTopicType;
  debateMode: DebateMode;
  stanceMode: DebateStanceMode;
  needFactChecker: boolean;
  needDomainExpert: boolean;
  recommendedAgents: string[];
  agentPersonas: Record<string, string>;
  rubric: DebateRubricItem[];
  evidenceRequirement: 'low' | 'medium' | 'high';
  maxRounds: number;
  debateThreshold: number;
  outputStyle: 'final_answer' | 'decision_record' | 'adr' | 'comparison_report';
  clarifyingQuestions: string[];
};

export type DebateRunInput = {
  topic: string;
  constraints?: string;
  configOverrides?: Partial<DebateConfig>;
};

export type DebateRunResponse = {
  run: WorkflowRun;
};

export type DeepResearchDepth = 'quick' | 'standard' | 'deep';

export type DeepResearchSourcePreference = 'web' | 'local' | 'mixed';

export type DeepResearchRunInput = {
  topic: string;
  scope?: string;
  depth?: DeepResearchDepth;
  sourcePreference?: DeepResearchSourcePreference;
  maxSearchRounds?: number;
  constraints?: string;
};

export type ResearchSourceReliability = 'low' | 'medium' | 'high';

export type ResearchSource = {
  id: string;
  title: string;
  url?: string;
  filePath?: string;
  publisher?: string;
  author?: string;
  publishedAt?: string;
  retrievedAt: number;
  summary: string;
  reliability: ResearchSourceReliability;
  notes?: string;
};

export type EvidenceConfidence = 'low' | 'medium' | 'high';

export type EvidenceItem = {
  id: string;
  claim: string;
  evidence: string;
  sourceIds: string[];
  confidence: EvidenceConfidence;
  supports?: string[];
  contradicts?: string[];
  limitations?: string;
};

export type DeepResearchConfig = {
  topic: string;
  scope?: string;
  depth: DeepResearchDepth;
  sourcePreference: DeepResearchSourcePreference;
  maxSearchRounds: number;
  evidenceRequirement: 'low' | 'medium' | 'high';
  actors: string[];
  stages: string[];
};

export type DeepResearchRunResponse = {
  run: WorkflowRun;
};

export type WorkflowToolPolicy = {
  enabled: boolean;
  allowedToolNames: string[];
  requireConfirmation: boolean;
  /** 审批模式。缺省为 interactive；定时任务链路传 unattended-safe。 */
  approvalMode?: ToolApprovalMode;
  maxToolRounds: number;
  maxToolCalls?: number;
  forceSummarizeOnLimit?: boolean;
};

export type CancelWorkflowResponse = {
  cancelled: boolean;
};

export type ExportWorkflowReportResponse = {
  /** 用户在保存对话框中取消时为 false。 */
  saved: boolean;
  filePath?: string;
};
