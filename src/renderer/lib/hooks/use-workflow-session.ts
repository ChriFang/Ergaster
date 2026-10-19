import { useCallback, useMemo, useRef, useState } from 'react';
import type { DebateRunInput, DeepResearchRunInput, WorkflowRun, WorkflowStreamEvent } from '../../../shared/workflow';
import { desktopAppClient } from '../desktop/desktop-app-client';
import { appendWorkflowStreamDelta, mergeRunSnapshot } from '../utils/workflow-stream';

type UseWorkflowSessionOptions = {
  input: string;
  setInput: (value: string) => void;
};

export function useWorkflowSession({ input, setInput }: UseWorkflowSessionOptions) {
  const [mode, setMode] = useState<'chat' | 'workflow' | 'code'>('chat');
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null);
  const [selectedWorkflowType, setSelectedWorkflowType] = useState<'debate' | 'deep_research' | 'custom'>('debate');
  // 仅当 selectedWorkflowType === 'custom' 时有意义
  const [selectedCustomWorkflowId, setSelectedCustomWorkflowId] = useState<string | null>(null);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [isWorkflowRunning, setIsWorkflowRunning] = useState(false);
  const [lastWorkflowError, setLastWorkflowError] = useState<string | null>(null);
  const [isExportingReport, setIsExportingReport] = useState(false);
  const [reportExportNotice, setReportExportNotice] = useState<{ kind: 'success' | 'error'; message: string; filePath?: string } | null>(null);
  const activeRunIdRef = useRef<string | null>(null);

  const workflowMessages = activeRun?.messages ?? [];
  const workflowArtifacts = activeRun?.artifacts ?? [];

  const loadWorkflowRuns = useCallback(async () => {
    const runs = await desktopAppClient.listWorkflowRuns();
    setWorkflowRuns(runs);
    return runs;
  }, []);

  const loadWorkflowRun = useCallback(async (runId: string) => {
    const run = await desktopAppClient.getWorkflowRun(runId);
    if (run) {
      activeRunIdRef.current = run.id;
      setActiveRun(run);
      setMode('workflow');
    }
    return run;
  }, []);

  async function startWorkflow(workflowType: 'debate' | 'deep_research' = 'debate') {
    const topic = input.trim();
    if (!topic) {
      setLastWorkflowError(workflowType === 'deep_research' ? '请输入研究议题。' : '请输入辩论议题。');
      return;
    }

    setMode('workflow');
    setSelectedWorkflowType(workflowType);
    setSelectedCustomWorkflowId(null);
    setInput('');
    setLastWorkflowError(null);
    setReportExportNotice(null);
    setIsWorkflowRunning(true);

    try {
      const response = workflowType === 'deep_research'
        ? await desktopAppClient.startDeepResearchWorkflow({ topic } satisfies DeepResearchRunInput)
        : await desktopAppClient.startDebateWorkflow({ topic } satisfies DebateRunInput);
      activeRunIdRef.current = response.run.id;
      setActiveRun((current) => mergeRunSnapshot(current, response.run));
      void loadWorkflowRuns().catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow 启动失败。';
      setLastWorkflowError(message);
      setIsWorkflowRunning(false);
    }
  }

  async function startDebateWorkflow() {
    await startWorkflow('debate');
  }

  async function startDeepResearchWorkflow() {
    await startWorkflow('deep_research');
  }

  async function startCustomWorkflow(workflowId: string, seedPrompt: string) {
    const trimmed = seedPrompt.trim();
    if (!trimmed) {
      setLastWorkflowError('请输入工作流运行输入。');
      return;
    }

    setMode('workflow');
    setSelectedWorkflowType('custom');
    setSelectedCustomWorkflowId(workflowId);
    setInput('');
    setLastWorkflowError(null);
    setReportExportNotice(null);
    setIsWorkflowRunning(true);

    try {
      const response = await desktopAppClient.startCustomWorkflow({ workflowId, seedPrompt: trimmed });
      activeRunIdRef.current = response.runId;
      const run = await desktopAppClient.getWorkflowRun(response.runId);
      if (run) {
        setActiveRun((current) => mergeRunSnapshot(current, run));
      }
      void loadWorkflowRuns().catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow 启动失败。';
      setLastWorkflowError(message);
      setIsWorkflowRunning(false);
    }
  }

  async function cancelWorkflow() {
    const runId = activeRunIdRef.current;
    if (!runId) {
      return;
    }
    await desktopAppClient.cancelWorkflowRun(runId);
    setIsWorkflowRunning(false);
  }

  const exportWorkflowReport = useCallback(async () => {
    const runId = activeRunIdRef.current;
    if (!runId) {
      setReportExportNotice({ kind: 'error', message: '当前没有可导出的运行记录。' });
      return;
    }

    setIsExportingReport(true);
    setReportExportNotice(null);

    try {
      const result = await desktopAppClient.exportWorkflowReport(runId);
      setReportExportNotice(result.saved
        ? { kind: 'success', message: '报告已保存', filePath: result.filePath }
        : null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出报告失败。';
      setReportExportNotice({ kind: 'error', message });
    } finally {
      setIsExportingReport(false);
    }
  }, []);

  const applyWorkflowStream = useCallback((event: WorkflowStreamEvent) => {    if (activeRunIdRef.current && event.runId !== activeRunIdRef.current) {
      return;
    }

    if (!activeRunIdRef.current) {
      activeRunIdRef.current = event.runId;
    }

    if (event.run) {
      setActiveRun((current) => mergeRunSnapshot(current, event.run as WorkflowRun));
    }

    if (event.type === 'message_delta') {
      setActiveRun((current) => {
        if (!current) {
          return current;
        }
        return { ...current, messages: appendWorkflowStreamDelta(current.messages, event), updatedAt: Date.now() };
      });
    }

    if (event.type === 'artifact_created' && event.artifact) {
      const artifact = event.artifact;
      setActiveRun((current) => {
        if (!current || current.artifacts.some((item) => item.id === artifact.id)) {
          return current;
        }
        return { ...current, artifacts: [...current.artifacts, artifact], updatedAt: Date.now() };
      });
    }

    if (event.type === 'metrics_updated' && event.metrics) {
      const metrics = event.metrics;
      setActiveRun((current) => (current ? { ...current, metrics } : current));
    }

    if (event.type === 'failed') {
      setLastWorkflowError(event.error ?? 'Workflow 执行失败。');
      setIsWorkflowRunning(false);
    }

    if (event.type === 'completed' || event.type === 'cancelled') {
      setIsWorkflowRunning(false);
      void loadWorkflowRuns().catch(() => {});
    }
  }, [loadWorkflowRuns]);

  const activeWorkflowTitle = useMemo(() => activeRun?.title ?? '通用议题辩论', [activeRun]);

  // 切换工作流类型：若与当前 run 不同，清空旧 run，避免上一类型的结果卡住界面
  const changeWorkflowType = useCallback((type: 'debate' | 'deep_research') => {
    setSelectedWorkflowType(type);
    setSelectedCustomWorkflowId(null);
    if (activeRun?.type && activeRun.type !== type) {
      setActiveRun(null);
      activeRunIdRef.current = null;
      setLastWorkflowError(null);
    }
  }, [activeRun?.type]);

  // 切到聊天模式（由侧边栏智能体选中触发）
  const selectChatMode = useCallback(() => {
    setMode('chat');
  }, []);

  // 切到代码分析模式（由侧边栏 Code 项目选中触发）
  const selectCodeMode = useCallback(() => {
    setMode('code');
  }, []);

  // 选中内置工作流（辩论/深度调研）并切到 workflow 模式
  const selectBuiltInWorkflow = useCallback((type: 'debate' | 'deep_research') => {
    setSelectedWorkflowType(type);
    setSelectedCustomWorkflowId(null);
    setMode('workflow');
    if (activeRun?.type && activeRun.type !== type) {
      setActiveRun(null);
      activeRunIdRef.current = null;
      setLastWorkflowError(null);
    }
  }, [activeRun?.type]);

  // 选中自定义工作流并切到 workflow 模式
  const selectCustomWorkflow = useCallback((workflowId: string) => {
    setSelectedWorkflowType('custom');
    setSelectedCustomWorkflowId(workflowId);
    setMode('workflow');
    const sameCustom = activeRun?.type === 'custom' && activeRun.inputs?.workflowId === workflowId;
    if (!sameCustom && activeRun) {
      setActiveRun(null);
      activeRunIdRef.current = null;
      setLastWorkflowError(null);
    }
  }, [activeRun?.type, activeRun?.inputs]);

  return {
    mode,
    setMode,
    activeRun,
    activeRunIdRef,
    selectedWorkflowType,
    setSelectedWorkflowType,
    selectedCustomWorkflowId,
    changeWorkflowType,
    selectChatMode,
    selectCodeMode,
    selectBuiltInWorkflow,
    selectCustomWorkflow,
    activeWorkflowTitle,
    workflowRuns,
    workflowMessages,
    workflowArtifacts,
    isWorkflowRunning,
    lastWorkflowError,
    setLastWorkflowError,
    isExportingReport,
    reportExportNotice,
    exportWorkflowReport,
    loadWorkflowRuns,
    loadWorkflowRun,
    startWorkflow,
    startDebateWorkflow,
    startDeepResearchWorkflow,
    startCustomWorkflow,
    cancelWorkflow,
    applyWorkflowStream,
  };
}
