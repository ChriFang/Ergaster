import type { AgentMessage, AgentStreamEvent } from '../../shared/agent';
import type { CancelWorkflowResponse, DebateRunInput, DebateRunResponse, DeepResearchRunInput, DeepResearchRunResponse, WorkflowActor, WorkflowMessageMeta, WorkflowRun, WorkflowRunMetrics, WorkflowStage, WorkflowStreamEvent } from '../../shared/workflow';
import type { CustomWorkflowRunInput, CustomWorkflowRunResponse, WorkflowDefinition } from '../../shared/workflow-definition';
import { agentService } from '../agent/agent-service';
import { agentProfilesService } from '../agent-profiles/agent-profiles-service';
import { getWorkflowNodeToolNames } from '../tools/tool-registry';
import { workflowDefinitionsService } from './workflow-definitions-service';
import { workflowMetrics } from './workflow-metrics';
import { createDebateActors, createDebateStages, runDebateWorkflow } from './runners/debate-runner';
import { createDeepResearchActors, createDeepResearchStages, runDeepResearchWorkflow } from './runners/deep-research-runner';

type WorkflowStreamListener = (event: WorkflowStreamEvent) => void;

/** token 估算每个流式增量都会变动，按固定间隔节流后再推给界面。 */
const METRICS_EMIT_INTERVAL_MS = 500;

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneRun(run: WorkflowRun): WorkflowRun {
  return {
    ...run,
    actors: run.actors.map((actor) => ({ ...actor })),
    stages: run.stages.map((stage) => ({ ...stage, actorIds: [...stage.actorIds] })),
    messages: run.messages.map((message) => ({ ...message, workflow: message.workflow ? { ...message.workflow } : undefined })),
    artifacts: run.artifacts.map((artifact) => ({ ...artifact })),
    inputs: { ...run.inputs },
    config: { ...run.config },
    metrics: run.metrics ? { ...run.metrics } : undefined,
  };
}

class WorkflowService {
  private runsById = new Map<string, WorkflowRun>();
  private abortControllersByRunId = new Map<string, AbortController>();
  private streamListeners = new Set<WorkflowStreamListener>();
  private lastMetricsEmitAtByRunId = new Map<string, number>();

  constructor() {
    agentService.onStream((event) => this.handleAgentStream(event));
    workflowMetrics.onChange((runId, metrics) => this.handleMetricsChange(runId, metrics));
  }

  /**
   * 把最新的 metrics 折进内存里的 run（快照、导出都会带上），
   * 并按间隔节流推给界面；运行结束的那次一定推出去。
   */
  private handleMetricsChange(runId: string, metrics: WorkflowRunMetrics) {
    const run = this.runsById.get(runId);
    if (!run) {
      return;
    }

    run.metrics = metrics;

    const now = Date.now();
    const lastEmitAt = this.lastMetricsEmitAtByRunId.get(runId) ?? 0;
    if (metrics.finishedAt === undefined && now - lastEmitAt < METRICS_EMIT_INTERVAL_MS) {
      return;
    }

    this.lastMetricsEmitAtByRunId.set(runId, now);
    this.emitStreamEvent({ runId, type: 'metrics_updated', metrics });
  }

  /** 运行进入终态时收口耗时，之后 metrics 不再变动。 */
  private finalizeMetrics(runId: string) {
    workflowMetrics.finish(runId, Date.now());
    this.lastMetricsEmitAtByRunId.delete(runId);
  }

  onStream(listener: WorkflowStreamListener) {
    this.streamListeners.add(listener);
    return () => {
      this.streamListeners.delete(listener);
    };
  }

  private emitStreamEvent(event: WorkflowStreamEvent) {
    for (const listener of this.streamListeners) {
      listener(event);
    }
  }

  private handleAgentStream(event: AgentStreamEvent) {
    const runId = event.workflow?.runId;
    if (!runId || !event.streamMessageId) {
      return;
    }

    if (event.done) {
      this.emitStreamEvent({
        runId,
        type: 'message_done',
        streamMessageId: event.streamMessageId,
        role: event.role,
        workflow: event.workflow,
      });
      return;
    }

    this.emitStreamEvent({
      runId,
      type: 'message_delta',
      streamMessageId: event.streamMessageId,
      deltaContent: event.deltaContent,
      deltaReasoningContent: event.deltaReasoningContent,
      role: event.role,
      workflow: event.workflow,
    });
  }

  private createDebateRun(input: DebateRunInput): WorkflowRun {
    const now = Date.now();
    const runId = createId('debate-run');
    const userMessage: AgentMessage = {
      id: createId('user-topic'),
      role: 'user',
      content: input.constraints ? `${input.topic}\n\n补充约束：${input.constraints}` : input.topic,
      workflow: {
        workflowId: runId,
        runId,
        workflowType: 'debate',
        stageId: 'input',
        actorId: 'user',
        actorRole: 'user',
        phase: 'topic',
      },
    };

    return {
      id: runId,
      type: 'debate',
      title: input.topic.replace(/\s+/g, ' ').slice(0, 80),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      inputs: { topic: input.topic, constraints: input.constraints ?? '' },
      config: {},
      actors: createDebateActors(),
      stages: createDebateStages(),
      messages: [userMessage],
      artifacts: [],
    };
  }

  private createDeepResearchRun(input: DeepResearchRunInput): WorkflowRun {
    const now = Date.now();
    const runId = createId('research-run');
    const userMessage: AgentMessage = {
      id: createId('user-research-topic'),
      role: 'user',
      content: input.constraints ? `${input.topic}\n\n补充约束：${input.constraints}` : input.topic,
      workflow: {
        workflowId: runId,
        runId,
        workflowType: 'deep_research',
        stageId: 'input',
        actorId: 'user',
        actorRole: 'user',
        phase: 'topic',
      },
    };

    return {
      id: runId,
      type: 'deep_research',
      title: input.topic.replace(/\s+/g, ' ').slice(0, 80),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      inputs: {
        topic: input.topic,
        scope: input.scope ?? '',
        constraints: input.constraints ?? '',
        depth: input.depth ?? 'standard',
        sourcePreference: input.sourcePreference ?? 'mixed',
        maxSearchRounds: input.maxSearchRounds ?? 2,
      },
      config: {},
      actors: createDeepResearchActors(),
      stages: createDeepResearchStages(),
      messages: [userMessage],
      artifacts: [],
    };
  }

  async startDebate(input: DebateRunInput): Promise<DebateRunResponse> {
    const topic = input.topic.trim();
    if (!topic) {
      throw new Error('请输入辩论议题。');
    }

    const run = this.createDebateRun({ ...input, topic });
    const abortController = new AbortController();
    this.runsById.set(run.id, run);
    this.abortControllersByRunId.set(run.id, abortController);
    workflowMetrics.start(run.id, run.createdAt);
    this.emitStreamEvent({ runId: run.id, type: 'run_updated', run: cloneRun(run) });

    void this.executeDebateInBackground({ ...input, topic }, run, abortController);

    return { run: cloneRun(run) };
  }

  async startDeepResearch(input: DeepResearchRunInput): Promise<DeepResearchRunResponse> {
    const topic = input.topic.trim();
    if (!topic) {
      throw new Error('请输入研究议题。');
    }

    const run = this.createDeepResearchRun({ ...input, topic });
    const abortController = new AbortController();
    this.runsById.set(run.id, run);
    this.abortControllersByRunId.set(run.id, abortController);
    workflowMetrics.start(run.id, run.createdAt);
    this.emitStreamEvent({ runId: run.id, type: 'run_updated', run: cloneRun(run) });

    void this.executeDeepResearchInBackground({ ...input, topic }, run, abortController);

    return { run: cloneRun(run) };
  }

  private async executeDebateInBackground(input: DebateRunInput, run: WorkflowRun, abortController: AbortController) {
    try {
      await runDebateWorkflow({
        input,
        run,
        signal: abortController.signal,
        onRunUpdated: (nextRun) => {
          this.runsById.set(nextRun.id, nextRun);
          this.emitStreamEvent({ runId: nextRun.id, type: 'run_updated', run: cloneRun(nextRun) });
        },
        onArtifactCreated: (artifact) => {
          this.emitStreamEvent({ runId: run.id, type: 'artifact_created', artifact });
        },
      });
      this.emitStreamEvent({ runId: run.id, type: 'completed', run: cloneRun(run) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow 执行失败。';
      run.status = abortController.signal.aborted ? 'cancelled' : 'failed';
      run.error = message;
      run.updatedAt = Date.now();
      this.runsById.set(run.id, run);
      this.emitStreamEvent({ runId: run.id, type: run.status === 'cancelled' ? 'cancelled' : 'failed', run: cloneRun(run), error: message });
    } finally {
      this.abortControllersByRunId.delete(run.id);
      // 收口耗时；这里会再推一次带 finishedAt 的 metrics_updated
      this.finalizeMetrics(run.id);
    }
  }

  private async executeDeepResearchInBackground(input: DeepResearchRunInput, run: WorkflowRun, abortController: AbortController) {
    try {
      await runDeepResearchWorkflow({
        input,
        run,
        signal: abortController.signal,
        onRunUpdated: (nextRun) => {
          this.runsById.set(nextRun.id, nextRun);
          this.emitStreamEvent({ runId: nextRun.id, type: 'run_updated', run: cloneRun(nextRun) });
        },
        onArtifactCreated: (artifact) => {
          this.emitStreamEvent({ runId: run.id, type: 'artifact_created', artifact });
        },
      });
      this.emitStreamEvent({ runId: run.id, type: 'completed', run: cloneRun(run) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow 执行失败。';
      run.status = abortController.signal.aborted ? 'cancelled' : 'failed';
      run.error = message;
      run.updatedAt = Date.now();
      this.runsById.set(run.id, run);
      this.emitStreamEvent({ runId: run.id, type: run.status === 'cancelled' ? 'cancelled' : 'failed', run: cloneRun(run), error: message });
    } finally {
      this.abortControllersByRunId.delete(run.id);
      this.finalizeMetrics(run.id);
    }
  }

  async startCustomWorkflow(input: CustomWorkflowRunInput): Promise<CustomWorkflowRunResponse> {
    const seedPrompt = input.seedPrompt.trim();
    if (!seedPrompt) {
      throw new Error('请输入工作流运行输入。');
    }

    const definition = workflowDefinitionsService.getWorkflowDefinition(input.workflowId);
    if (!definition) {
      throw new Error(`未找到 ID 为 "${input.workflowId}" 的工作流。`);
    }

    if (definition.nodes.length === 0) {
      throw new Error('该工作流没有节点，无法运行。');
    }

    const run = this.createCustomRun(definition, seedPrompt);
    const abortController = new AbortController();
    this.runsById.set(run.id, run);
    this.abortControllersByRunId.set(run.id, abortController);
    workflowMetrics.start(run.id, run.createdAt);
    this.emitStreamEvent({ runId: run.id, type: 'run_updated', run: cloneRun(run) });

    void this.executeCustomInBackground(definition, run, abortController);

    return { runId: run.id };
  }

  private createCustomRun(definition: WorkflowDefinition, seedPrompt: string): WorkflowRun {
    const now = Date.now();
    const runId = createId('custom-run');

    const actors: WorkflowActor[] = definition.nodes.map((node) => {
      const agent = agentProfilesService.getAgentDetail(node.agentId);
      return {
        id: node.id,
        role: 'agent',
        title: node.label?.trim() || agent?.title || node.id,
        description: agent ? `${agent.title}${agent.description ? ` · ${agent.description}` : ''}` : '智能体已失效',
        status: 'pending',
      };
    });

    const stages: WorkflowStage[] = definition.nodes.map((node, index) => ({
      id: node.id,
      title: `节点 ${index + 1}：${actors[index].title}`,
      status: 'pending',
      actorIds: [node.id],
    }));

    const userMessage: AgentMessage = {
      id: createId('user-seed'),
      role: 'user',
      content: seedPrompt,
      workflow: {
        workflowId: runId,
        runId,
        workflowType: 'custom',
        stageId: 'input',
        actorId: 'user',
        actorRole: 'user',
        phase: 'seed',
      },
    };

    return {
      id: runId,
      type: 'custom',
      title: definition.title,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      inputs: { workflowId: definition.id, seedPrompt },
      config: { nodes: definition.nodes.length },
      actors,
      stages,
      messages: [userMessage],
      artifacts: [],
    };
  }

  private updateCustomStageStatus(run: WorkflowRun, stageId: string, status: WorkflowStage['status']) {
    run.currentStageId = stageId;
    run.stages = run.stages.map((stage) => (stage.id === stageId ? { ...stage, status } : stage));
    run.updatedAt = Date.now();
  }

  private updateCustomActorStatus(run: WorkflowRun, actorId: string, status: WorkflowActor['status']) {
    run.actors = run.actors.map((actor) => (actor.id === actorId ? { ...actor, status } : actor));
    run.updatedAt = Date.now();
  }

  private async executeCustomInBackground(definition: WorkflowDefinition, run: WorkflowRun, abortController: AbortController) {
    try {
      run.status = 'running';
      run.updatedAt = Date.now();
      this.runsById.set(run.id, run);
      this.emitStreamEvent({ runId: run.id, type: 'run_updated', run: cloneRun(run) });

      const seedPrompt = String((run.inputs as { seedPrompt?: string }).seedPrompt ?? '');
      let prevOutput = seedPrompt;

      for (const node of definition.nodes) {
        if (abortController.signal.aborted) {
          break;
        }

        const agent = agentProfilesService.getAgentDetail(node.agentId);
        if (!agent) {
          run.status = 'failed';
          run.error = `节点「${node.label?.trim() || node.id}」引用的智能体已失效，请编辑工作流重新选择。`;
          run.updatedAt = Date.now();
          break;
        }

        this.updateCustomStageStatus(run, node.id, 'running');
        this.updateCustomActorStatus(run, node.id, 'running');
        this.runsById.set(run.id, run);
        this.emitStreamEvent({ runId: run.id, type: 'run_updated', run: cloneRun(run) });

        const prompt = node.inputTemplate
          ? node.inputTemplate.replace(/\{\{input\}\}/g, prevOutput)
          : prevOutput;

        const meta: WorkflowMessageMeta = {
          workflowId: run.id,
          runId: run.id,
          workflowType: 'custom',
          stageId: node.id,
          actorId: node.id,
          actorRole: agent.title,
          phase: 'execute',
        };

        const allowedToolNames = await getWorkflowNodeToolNames(node.agentId);

        const message = await agentService.runOneShot({
          messages: [{ role: 'user', content: prompt }],
          systemPrompt: agent.content || undefined,
          agentId: node.agentId,
          workflowMeta: meta,
          signal: abortController.signal,
          toolsPolicy: {
            enabled: allowedToolNames.length > 0,
            allowedToolNames,
            requireConfirmation: false,
            maxToolRounds: 20,
            maxToolCalls: 300,
            forceSummarizeOnLimit: true,
          },
        });

        run.messages.push(message);
        this.updateCustomStageStatus(run, node.id, 'completed');
        this.updateCustomActorStatus(run, node.id, 'completed');
        this.runsById.set(run.id, run);
        this.emitStreamEvent({ runId: run.id, type: 'run_updated', run: cloneRun(run) });

        prevOutput = message.content ?? '';
      }

      if (abortController.signal.aborted) {
        run.status = 'cancelled';
      } else if (run.status !== 'failed') {
        run.status = 'completed';
      }
      run.updatedAt = Date.now();
      this.runsById.set(run.id, run);
      this.emitStreamEvent({ runId: run.id, type: run.status === 'cancelled' ? 'cancelled' : run.status === 'failed' ? 'failed' : 'completed', run: cloneRun(run), error: run.error });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow 执行失败。';
      run.status = abortController.signal.aborted ? 'cancelled' : 'failed';
      run.error = message;
      run.updatedAt = Date.now();
      this.runsById.set(run.id, run);
      this.emitStreamEvent({ runId: run.id, type: run.status === 'cancelled' ? 'cancelled' : 'failed', run: cloneRun(run), error: message });
    } finally {
      this.abortControllersByRunId.delete(run.id);
      this.finalizeMetrics(run.id);
    }
  }

  cancelWorkflow(runId: string): CancelWorkflowResponse {
    const abortController = this.abortControllersByRunId.get(runId);
    if (!abortController) {
      return { cancelled: false };
    }

    abortController.abort();
    const run = this.runsById.get(runId);
    if (run) {
      run.status = 'cancelled';
      run.updatedAt = Date.now();
      this.emitStreamEvent({ runId, type: 'cancelled', run: cloneRun(run) });
    }
    this.abortControllersByRunId.delete(runId);
    return { cancelled: true };
  }

  getWorkflowRun(runId: string) {
    const run = this.runsById.get(runId);
    return run ? cloneRun(run) : null;
  }

  listWorkflowRuns() {
    return Array.from(this.runsById.values())
      .map(cloneRun)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }
}

export const workflowService = new WorkflowService();
