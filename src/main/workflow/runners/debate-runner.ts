import type { AgentMessage } from '../../../shared/agent';
import type { DebateConfig, DebateRunInput, WorkflowActor, WorkflowArtifact, WorkflowMessageMeta, WorkflowRun, WorkflowStage } from '../../../shared/workflow';
import type { ChatCompletionApiMessage } from '../../agent/deepseek-client';
import { agentService } from '../../agent/agent-service';
import {
  buildClassifierPrompt,
  buildCriticPrompt,
  buildJudgePrompt,
  buildProposalPrompt,
  buildRevisionPrompt,
  createDefaultDebateConfig,
} from './debate-prompts';

type DebateRunnerOptions = {
  input: DebateRunInput;
  run: WorkflowRun;
  signal: AbortSignal;
  onRunUpdated: (run: WorkflowRun) => void;
  onArtifactCreated: (artifact: WorkflowArtifact) => void;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDebateActors(): WorkflowActor[] {
  return [
    { id: 'classifier', role: 'classifier', title: 'Topic Classifier', description: '识别议题类型并生成配置', status: 'pending' },
    { id: 'agent_a', role: 'proposer', title: 'Agent A', description: '支持或积极推进主张', status: 'pending' },
    { id: 'agent_b', role: 'proposer', title: 'Agent B', description: '反对或审慎评估主张', status: 'pending' },
    { id: 'critic', role: 'critic', title: 'Critic', description: '审查漏洞、反例和风险', status: 'pending' },
    { id: 'judge', role: 'judge', title: 'Judge', description: '按 rubric 评分并裁决', status: 'pending' },
  ];
}

export function createDebateStages(): WorkflowStage[] {
  return [
    { id: 'classify', title: '议题识别', status: 'pending', actorIds: ['classifier'] },
    { id: 'proposal', title: '独立立论', status: 'pending', actorIds: ['agent_a', 'agent_b'] },
    { id: 'critique', title: '交叉批判', status: 'pending', actorIds: ['critic'] },
    { id: 'revision', title: '回应修正', status: 'pending', actorIds: ['agent_a', 'agent_b'] },
    { id: 'judgement', title: '评分裁决', status: 'pending', actorIds: ['judge'] },
  ];
}

function updateStage(run: WorkflowRun, stageId: string, status: WorkflowStage['status']) {
  run.currentStageId = stageId;
  run.stages = run.stages.map((stage) => (stage.id === stageId ? { ...stage, status } : stage));
  run.updatedAt = Date.now();
}

function updateActor(run: WorkflowRun, actorId: string, status: WorkflowActor['status']) {
  run.actors = run.actors.map((actor) => (actor.id === actorId ? { ...actor, status } : actor));
  run.updatedAt = Date.now();
}

function createMeta(run: WorkflowRun, stageId: string, actorId: string, actorRole: string, phase: string, artifactType?: string): WorkflowMessageMeta {
  return {
    workflowId: run.id,
    runId: run.id,
    workflowType: 'debate',
    stageId,
    stepId: `${stageId}:${actorId}`,
    actorId,
    actorRole,
    phase,
    artifactType,
  };
}

function toUserMessage(content: string): ChatCompletionApiMessage {
  return { role: 'user', content };
}

async function runActor(run: WorkflowRun, options: {
  stageId: string;
  actorId: string;
  actorRole: string;
  phase: string;
  prompt: string;
  signal: AbortSignal;
}) {
  updateActor(run, options.actorId, 'running');
  const meta = createMeta(run, options.stageId, options.actorId, options.actorRole, options.phase);
  const message = await agentService.runOneShot({
    messages: [toUserMessage(options.prompt)],
    workflowMeta: meta,
    signal: options.signal,
  });
  run.messages.push(message);
  updateActor(run, options.actorId, 'completed');
  return message;
}

function addArtifact(run: WorkflowRun, onArtifactCreated: (artifact: WorkflowArtifact) => void, type: string, title: string, data: unknown, stageId: string, actorId?: string) {
  const artifact: WorkflowArtifact = {
    id: createId(`artifact-${type}`),
    runId: run.id,
    workflowType: 'debate',
    type,
    title,
    data,
    createdAt: Date.now(),
    stageId,
    actorId,
  };
  run.artifacts.push(artifact);
  run.updatedAt = Date.now();
  onArtifactCreated(artifact);
  return artifact;
}

function mergeConfig(input: DebateRunInput): DebateConfig {
  return {
    ...createDefaultDebateConfig(input.topic, input.constraints),
    ...input.configOverrides,
    topic: input.topic,
  };
}

export async function runDebateWorkflow({ input, run, signal, onRunUpdated, onArtifactCreated }: DebateRunnerOptions) {
  run.status = 'running';
  run.updatedAt = Date.now();
  onRunUpdated(run);

  updateStage(run, 'classify', 'running');
  onRunUpdated(run);
  const config = mergeConfig(input);
  run.config = { debate: config };
  const classifierMessage = await runActor(run, {
    stageId: 'classify',
    actorId: 'classifier',
    actorRole: 'classifier',
    phase: 'classify',
    prompt: buildClassifierPrompt(input.topic, input.constraints),
    signal,
  });
  addArtifact(run, onArtifactCreated, 'debate_config', '辩论配置', { ...config, classifierOutput: classifierMessage.content }, 'classify', 'classifier');
  updateStage(run, 'classify', 'completed');
  onRunUpdated(run);

  updateStage(run, 'proposal', 'running');
  onRunUpdated(run);
  const proposalA = await runActor(run, {
    stageId: 'proposal',
    actorId: 'agent_a',
    actorRole: 'proposer',
    phase: 'proposal',
    prompt: buildProposalPrompt(config, 'AgentA', input.constraints),
    signal,
  });
  addArtifact(run, onArtifactCreated, 'proposal_a', 'Agent A 初始观点', proposalA.content, 'proposal', 'agent_a');
  const proposalB = await runActor(run, {
    stageId: 'proposal',
    actorId: 'agent_b',
    actorRole: 'proposer',
    phase: 'proposal',
    prompt: buildProposalPrompt(config, 'AgentB', input.constraints),
    signal,
  });
  addArtifact(run, onArtifactCreated, 'proposal_b', 'Agent B 初始观点', proposalB.content, 'proposal', 'agent_b');
  updateStage(run, 'proposal', 'completed');
  onRunUpdated(run);

  updateStage(run, 'critique', 'running');
  onRunUpdated(run);
  const critique = await runActor(run, {
    stageId: 'critique',
    actorId: 'critic',
    actorRole: 'critic',
    phase: 'critique',
    prompt: buildCriticPrompt(config, proposalA.content, proposalB.content),
    signal,
  });
  addArtifact(run, onArtifactCreated, 'critique', 'Critic 批判意见', critique.content, 'critique', 'critic');
  updateStage(run, 'critique', 'completed');
  onRunUpdated(run);

  updateStage(run, 'revision', 'running');
  onRunUpdated(run);
  const revisionA = await runActor(run, {
    stageId: 'revision',
    actorId: 'agent_a',
    actorRole: 'proposer',
    phase: 'revision',
    prompt: buildRevisionPrompt(config, 'AgentA', proposalA.content, critique.content),
    signal,
  });
  addArtifact(run, onArtifactCreated, 'revision_a', 'Agent A 修正观点', revisionA.content, 'revision', 'agent_a');
  const revisionB = await runActor(run, {
    stageId: 'revision',
    actorId: 'agent_b',
    actorRole: 'proposer',
    phase: 'revision',
    prompt: buildRevisionPrompt(config, 'AgentB', proposalB.content, critique.content),
    signal,
  });
  addArtifact(run, onArtifactCreated, 'revision_b', 'Agent B 修正观点', revisionB.content, 'revision', 'agent_b');
  updateStage(run, 'revision', 'completed');
  onRunUpdated(run);

  updateStage(run, 'judgement', 'running');
  onRunUpdated(run);
  const judgement = await runActor(run, {
    stageId: 'judgement',
    actorId: 'judge',
    actorRole: 'judge',
    phase: 'judgement',
    prompt: buildJudgePrompt(config, proposalA.content, proposalB.content, critique.content, revisionA.content, revisionB.content),
    signal,
  });
  addArtifact(run, onArtifactCreated, 'final_decision', '最终裁决', judgement.content, 'judgement', 'judge');
  addArtifact(run, onArtifactCreated, 'scoring_table', '评分表', judgement.content, 'judgement', 'judge');
  updateStage(run, 'judgement', 'completed');
  run.currentStageId = undefined;
  run.status = 'completed';
  run.updatedAt = Date.now();
  onRunUpdated(run);

  return run;
}
