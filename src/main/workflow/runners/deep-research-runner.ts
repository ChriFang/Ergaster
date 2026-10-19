import type { AgentMessage } from '../../../shared/agent';
import type {
  DeepResearchConfig,
  DeepResearchRunInput,
  WorkflowActor,
  WorkflowArtifact,
  WorkflowMessageMeta,
  WorkflowRun,
  WorkflowStage,
  WorkflowToolPolicy,
} from '../../../shared/workflow';
import type { ChatCompletionApiMessage } from '../../agent/deepseek-client';
import { agentService } from '../../agent/agent-service';
import {
  buildEvidenceExtractorPrompt,
  buildFactCheckerPrompt,
  buildGapAnalyzerPrompt,
  buildResearchPlannerPrompt,
  buildResearchSubtaskPrompt,
  buildResearcherPrompt,
  buildSupplementalResearchPrompt,
  buildSynthesizerPrompt,
  createDefaultDeepResearchConfig,
  maxSubtaskCount,
  parseResearchSubtasks,
  shouldRunAnotherResearchRound,
  type ResearchSubtask,
} from './deep-research-prompts';

type DeepResearchRunnerOptions = {
  input: DeepResearchRunInput;
  run: WorkflowRun;
  signal: AbortSignal;
  onRunUpdated: (run: WorkflowRun) => void;
  onArtifactCreated: (artifact: WorkflowArtifact) => void;
};

const DISABLED_TOOL_POLICY: WorkflowToolPolicy = {
  enabled: false,
  allowedToolNames: [],
  requireConfirmation: false,
  maxToolRounds: 0,
};

const RESEARCHER_TOOL_POLICY: WorkflowToolPolicy = {
  enabled: true,
  allowedToolNames: ['http_request', 'read_file', 'search_files'],
  requireConfirmation: true,
  maxToolRounds: 20,
  maxToolCalls: 300,
  forceSummarizeOnLimit: true,
};

const FACT_CHECKER_TOOL_POLICY: WorkflowToolPolicy = {
  enabled: true,
  allowedToolNames: ['http_request'],
  requireConfirmation: true,
  maxToolRounds: 20,
  maxToolCalls: 300,
  forceSummarizeOnLimit: true,
};

function getDeepResearchToolPolicy(actorId: string): WorkflowToolPolicy {
  if (actorId === 'researcher') {
    return RESEARCHER_TOOL_POLICY;
  }

  if (actorId === 'fact_checker') {
    return FACT_CHECKER_TOOL_POLICY;
  }

  return DISABLED_TOOL_POLICY;
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDeepResearchActors(): WorkflowActor[] {
  return [
    { id: 'planner', role: 'planner', title: 'Research Planner', description: '拆解研究问题并制定研究计划', status: 'pending' },
    { id: 'researcher', role: 'researcher', title: 'Researcher', description: '收集资料和来源', status: 'pending' },
    { id: 'evidence_extractor', role: 'evidence_extractor', title: 'Evidence Extractor', description: '抽取结构化证据', status: 'pending' },
    { id: 'fact_checker', role: 'fact_checker', title: 'Fact Checker', description: '核验证据可靠性和冲突点', status: 'pending' },
    { id: 'gap_analyzer', role: 'gap_analyzer', title: 'Gap Analyzer', description: '判断证据缺口和追加研究需求', status: 'pending' },
    { id: 'synthesizer', role: 'synthesizer', title: 'Synthesizer', description: '生成最终研究报告', status: 'pending' },
  ];
}

export function createDeepResearchStages(): WorkflowStage[] {
  return [
    { id: 'plan', title: '研究规划', status: 'pending', actorIds: ['planner'] },
    { id: 'collect', title: '资料收集', status: 'pending', actorIds: ['researcher'] },
    { id: 'extract', title: '证据抽取', status: 'pending', actorIds: ['evidence_extractor'] },
    { id: 'verify', title: '事实核验', status: 'pending', actorIds: ['fact_checker'] },
    { id: 'gap', title: '缺口分析', status: 'pending', actorIds: ['gap_analyzer'] },
    { id: 'synthesize', title: '报告生成', status: 'pending', actorIds: ['synthesizer'] },
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
    workflowType: 'deep_research',
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
  toolsPolicy?: WorkflowToolPolicy;
}) {
  updateActor(run, options.actorId, 'running');
  const meta = createMeta(run, options.stageId, options.actorId, options.actorRole, options.phase);
  const message = await agentService.runOneShot({
    messages: [toUserMessage(options.prompt)],
    workflowMeta: meta,
    signal: options.signal,
    toolsPolicy: options.toolsPolicy ?? getDeepResearchToolPolicy(options.actorId),
    onToolMessage: (toolMessage) => {
      run.messages.push(toolMessage);
    },
  });
  run.messages.push(message);
  updateActor(run, options.actorId, 'completed');
  return message;
}

/** 子智能体在 run 中的 actorId，必须与 agentService.runSubagent 生成的规则一致。 */
function subagentActorId(parentActorId: string, label: string) {
  return `${parentActorId}:${label}`;
}

/** 运行时动态登记 actor 并挂到对应 stage 上，供 fan-out 的子智能体使用。 */
function ensureActor(run: WorkflowRun, stageId: string, actor: WorkflowActor) {
  if (!run.actors.some((item) => item.id === actor.id)) {
    run.actors = [...run.actors, actor];
  }

  run.stages = run.stages.map((stage) => (
    stage.id === stageId && !stage.actorIds.includes(actor.id)
      ? { ...stage, actorIds: [...stage.actorIds, actor.id] }
      : stage
  ));
  run.updatedAt = Date.now();
}

function addArtifact(run: WorkflowRun, onArtifactCreated: (artifact: WorkflowArtifact) => void, type: string, title: string, data: unknown, stageId: string, actorId?: string) {
  const artifact: WorkflowArtifact = {
    id: createId(`artifact-${type}`),
    runId: run.id,
    workflowType: 'deep_research',
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

function addTextArtifactFromMessage(run: WorkflowRun, onArtifactCreated: (artifact: WorkflowArtifact) => void, type: string, title: string, message: AgentMessage, stageId: string, actorId: string) {
  return addArtifact(run, onArtifactCreated, type, title, message.content, stageId, actorId);
}

function mergeConfig(input: DeepResearchRunInput): DeepResearchConfig {
  return createDefaultDeepResearchConfig(input);
}

const RESEARCHER_PARENT_ACTOR_ID = 'researcher';

/**
 * collect 阶段的并行 fan-out：每个子任务派发一个独立子智能体。
 * 编排保持在代码里（子任务数量、工具白名单、失败降级都是确定的），
 * 子智能体只作为"带独立上下文的并行执行单元"。
 */
async function runResearchFanOut(run: WorkflowRun, options: {
  stageId: string;
  config: DeepResearchConfig;
  subtasks: ResearchSubtask[];
  signal: AbortSignal;
  onRunUpdated: (run: WorkflowRun) => void;
}) {
  const parentMeta = createMeta(run, options.stageId, RESEARCHER_PARENT_ACTOR_ID, 'researcher', 'collect');
  updateActor(run, RESEARCHER_PARENT_ACTOR_ID, 'running');

  for (const subtask of options.subtasks) {
    ensureActor(run, options.stageId, {
      id: subagentActorId(RESEARCHER_PARENT_ACTOR_ID, subtask.id),
      role: 'researcher',
      title: `Researcher · ${subtask.title}`,
      description: subtask.instruction.slice(0, 200),
      status: 'running',
    });
  }
  options.onRunUpdated(run);

  const sections = await Promise.all(options.subtasks.map(async (subtask) => {
    const actorId = subagentActorId(RESEARCHER_PARENT_ACTOR_ID, subtask.id);

    try {
      const message = await agentService.runSubagent({
        task: buildResearchSubtaskPrompt(options.config, subtask),
        role: 'researcher',
        label: subtask.id,
        allowedToolNames: RESEARCHER_TOOL_POLICY.allowedToolNames,
        depth: 1,
        signal: options.signal,
        parentWorkflowMeta: parentMeta,
        onToolMessage: (toolMessage) => {
          run.messages.push(toolMessage);
        },
      });
      run.messages.push(message);
      updateActor(run, actorId, 'completed');
      return `【${subtask.id} ${subtask.title}】\n${message.content}`;
    } catch (error) {
      if (options.signal.aborted) {
        throw error;
      }

      // 单个子任务失败不应让整轮调研崩掉，降级为显式标注的缺失项
      const reason = error instanceof Error ? error.message : '子任务执行失败。';
      updateActor(run, actorId, 'failed');
      return `【${subtask.id} ${subtask.title}】\n调研失败，本子任务无可用资料：${reason}`;
    }
  }));

  updateActor(run, RESEARCHER_PARENT_ACTOR_ID, 'completed');
  options.onRunUpdated(run);
  return sections.join('\n\n---\n\n');
}

export async function runDeepResearchWorkflow({ input, run, signal, onRunUpdated, onArtifactCreated }: DeepResearchRunnerOptions) {
  run.status = 'running';
  run.updatedAt = Date.now();
  onRunUpdated(run);

  const config = mergeConfig(input);
  run.config = { deepResearch: config };
  addArtifact(run, onArtifactCreated, 'research_config', '研究配置', config, 'plan', 'planner');

  updateStage(run, 'plan', 'running');
  onRunUpdated(run);
  const plan = await runActor(run, {
    stageId: 'plan',
    actorId: 'planner',
    actorRole: 'planner',
    phase: 'plan',
    prompt: buildResearchPlannerPrompt(config, input.constraints),
    signal,
  });
  addTextArtifactFromMessage(run, onArtifactCreated, 'research_plan', '研究计划', plan, 'plan', 'planner');
  updateStage(run, 'plan', 'completed');
  onRunUpdated(run);

  updateStage(run, 'collect', 'running');
  onRunUpdated(run);
  const subtasks = parseResearchSubtasks(plan.content, maxSubtaskCount(config));
  let sourcesText: string;

  if (subtasks.length > 0) {
    addArtifact(run, onArtifactCreated, 'research_subtasks', '并行调研子任务', subtasks, 'collect', RESEARCHER_PARENT_ACTOR_ID);
    sourcesText = await runResearchFanOut(run, { stageId: 'collect', config, subtasks, signal, onRunUpdated });
  } else {
    // planner 未产出可解析的子任务清单时，回退到单个 researcher 的旧路径
    const sources = await runActor(run, {
      stageId: 'collect',
      actorId: RESEARCHER_PARENT_ACTOR_ID,
      actorRole: 'researcher',
      phase: 'collect',
      prompt: buildResearcherPrompt(config, plan.content, input.constraints),
      signal,
    });
    sourcesText = sources.content;
  }

  addArtifact(run, onArtifactCreated, 'source_list', '来源列表', sourcesText, 'collect', RESEARCHER_PARENT_ACTOR_ID);
  updateStage(run, 'collect', 'completed');
  onRunUpdated(run);

  let evidenceText = '';
  let verificationText = '';
  let gapText = '';

  for (let researchRound = 1; ; researchRound += 1) {
    const roundSuffix = researchRound > 1 ? `（第 ${researchRound} 轮）` : '';

    updateStage(run, 'extract', 'running');
    onRunUpdated(run);
    const evidence = await runActor(run, {
      stageId: 'extract',
      actorId: 'evidence_extractor',
      actorRole: 'evidence_extractor',
      phase: 'extract',
      prompt: buildEvidenceExtractorPrompt(config, plan.content, sourcesText),
      signal,
    });
    evidenceText = evidence.content;
    addTextArtifactFromMessage(run, onArtifactCreated, 'evidence_table', `证据表${roundSuffix}`, evidence, 'extract', 'evidence_extractor');
    updateStage(run, 'extract', 'completed');
    onRunUpdated(run);

    updateStage(run, 'verify', 'running');
    onRunUpdated(run);
    const verification = await runActor(run, {
      stageId: 'verify',
      actorId: 'fact_checker',
      actorRole: 'fact_checker',
      phase: 'verify',
      prompt: buildFactCheckerPrompt(config, evidenceText, sourcesText),
      signal,
    });
    verificationText = verification.content;
    addTextArtifactFromMessage(run, onArtifactCreated, 'verification_report', `核验报告${roundSuffix}`, verification, 'verify', 'fact_checker');
    updateStage(run, 'verify', 'completed');
    onRunUpdated(run);

    updateStage(run, 'gap', 'running');
    onRunUpdated(run);
    const gap = await runActor(run, {
      stageId: 'gap',
      actorId: 'gap_analyzer',
      actorRole: 'gap_analyzer',
      phase: 'gap',
      prompt: buildGapAnalyzerPrompt(config, verificationText, evidenceText),
      signal,
    });
    gapText = gap.content;
    addTextArtifactFromMessage(run, onArtifactCreated, 'gap_analysis', `缺口分析${roundSuffix}`, gap, 'gap', 'gap_analyzer');
    updateStage(run, 'gap', 'completed');
    onRunUpdated(run);

    // 回环上限由 config.maxSearchRounds 硬性控制，模型只有"是否需要"的建议权
    if (researchRound >= config.maxSearchRounds || !shouldRunAnotherResearchRound(gapText)) {
      break;
    }

    const nextRound = researchRound + 1;
    updateStage(run, 'collect', 'running');
    onRunUpdated(run);
    const supplement = await runActor(run, {
      stageId: 'collect',
      actorId: RESEARCHER_PARENT_ACTOR_ID,
      actorRole: 'researcher',
      phase: 'collect',
      prompt: buildSupplementalResearchPrompt(config, gapText, nextRound),
      signal,
    });
    sourcesText = `${sourcesText}\n\n---\n\n【第 ${nextRound} 轮补充调研】\n${supplement.content}`;
    addTextArtifactFromMessage(run, onArtifactCreated, 'source_list', `补充来源（第 ${nextRound} 轮）`, supplement, 'collect', RESEARCHER_PARENT_ACTOR_ID);
    updateStage(run, 'collect', 'completed');
    onRunUpdated(run);
  }

  updateStage(run, 'synthesize', 'running');
  onRunUpdated(run);
  const finalReport = await runActor(run, {
    stageId: 'synthesize',
    actorId: 'synthesizer',
    actorRole: 'synthesizer',
    phase: 'synthesize',
    prompt: buildSynthesizerPrompt(config, {
      plan: plan.content,
      sources: sourcesText,
      evidence: evidenceText,
      verification: verificationText,
      gap: gapText,
    }),
    signal,
  });
  addTextArtifactFromMessage(run, onArtifactCreated, 'final_report', '最终研究报告', finalReport, 'synthesize', 'synthesizer');
  updateStage(run, 'synthesize', 'completed');
  run.currentStageId = undefined;
  run.status = 'completed';
  run.updatedAt = Date.now();
  onRunUpdated(run);

  return run;
}
