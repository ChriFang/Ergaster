import type { WorkflowRunMetrics } from '../../shared/workflow';
import { estimateMessagesTokenCount, scoreTokens } from '../core/token-utils';
import type { ChatCompletionApiMessage } from '../agent/deepseek-client';

type MetricsListener = (runId: string, metrics: WorkflowRunMetrics) => void;

type MutableMetrics = {
  startedAt: number;
  finishedAt?: number;
  modelRequests: number;
  /** 未取整的累加分值，避免逐段取整放大误差。 */
  promptScore: number;
  completionScore: number;
};

function toSnapshot(state: MutableMetrics): WorkflowRunMetrics {
  const promptTokens = Math.ceil(state.promptScore);
  const completionTokens = Math.ceil(state.completionScore);

  return {
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    modelRequests: state.modelRequests,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

/**
 * 按 runId 归集一次工作流运行的 token 与耗时。
 *
 * token 是本地估算值（与摘要阈值用的是同一套权重），不是上游返回的真实 usage：
 * 当前模型客户端没有请求也没有解析 usage 字段。估算用于观察量级，不能用于对账。
 *
 * 写入方是 agent-service（每次模型请求前后），读取方是 workflow-service（折进 run 并推给界面）。
 */
class WorkflowMetricsCollector {
  private stateByRunId = new Map<string, MutableMetrics>();
  private listeners = new Set<MetricsListener>();

  onChange(listener: MetricsListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(runId: string) {
    const state = this.stateByRunId.get(runId);
    if (!state) {
      return;
    }

    const snapshot = toSnapshot(state);
    for (const listener of this.listeners) {
      listener(runId, snapshot);
    }
  }

  start(runId: string, startedAt: number) {
    this.stateByRunId.set(runId, {
      startedAt,
      modelRequests: 0,
      promptScore: 0,
      completionScore: 0,
    });
    this.notify(runId);
  }

  /** 每次模型请求发出前调用，按实际发送的消息估算输入 token。 */
  addRequest(runId: string, messages: ChatCompletionApiMessage[]) {
    const state = this.stateByRunId.get(runId);
    if (!state) {
      return;
    }

    state.modelRequests += 1;
    state.promptScore += estimateMessagesTokenCount(messages);
    this.notify(runId);
  }

  /** 流式增量到达时调用，传入本次新增的正文与 reasoning 文本。 */
  addCompletionText(runId: string, ...texts: Array<string | undefined>) {
    const state = this.stateByRunId.get(runId);
    if (!state) {
      return;
    }

    let added = 0;
    for (const text of texts) {
      if (text) {
        added += scoreTokens(text);
      }
    }

    if (added <= 0) {
      return;
    }

    state.completionScore += added;
    this.notify(runId);
  }

  finish(runId: string, finishedAt: number) {
    const state = this.stateByRunId.get(runId);
    if (!state || state.finishedAt !== undefined) {
      return;
    }

    state.finishedAt = finishedAt;
    this.notify(runId);
  }

  get(runId: string): WorkflowRunMetrics | null {
    const state = this.stateByRunId.get(runId);
    return state ? toSnapshot(state) : null;
  }

  remove(runId: string) {
    this.stateByRunId.delete(runId);
  }
}

export const workflowMetrics = new WorkflowMetricsCollector();
export { WorkflowMetricsCollector };
