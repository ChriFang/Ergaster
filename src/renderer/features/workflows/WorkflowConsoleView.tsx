import { memo, useEffect, useState } from 'react';
import type { FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { Coins, Download, GitBranch, MessagesSquare, Scale, Search, Timer, Users, Workflow as WorkflowIcon } from 'lucide-react';
import type { WorkflowArtifact, WorkflowRun } from '../../../shared/workflow';
import type { WorkflowDefinitionListItem } from '../../../shared/workflow-definition';
import type { ReasoningEffort } from '../../../shared/config';
import type { ContextMenuState } from '../../lib/types/app-shell';
import { formatElapsed, formatTokenCount } from '../../lib/utils/format-metrics';
import { ActivityPanel } from '../activity/ActivityPanel';
import { Composer } from '../composer/Composer';
import { MessageContextMenu } from '../context-menu/MessageContextMenu';
import { MessageList } from '../messages/MessageList';

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  configured: '已配置',
  running: '运行中',
  waiting_user: '等待确认',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  pending: '待执行',
};

type WorkflowConsoleViewProps = {
  activeRun: WorkflowRun | null;
  workflowArtifacts: WorkflowArtifact[];
  selectedWorkflowType: 'debate' | 'deep_research' | 'custom';
  selectedCustomWorkflowId: string | null;
  workflows: WorkflowDefinitionListItem[];
  expandedToolMessageKeys: Record<string, boolean>;
  onToggleToolMessage: (messageKey: string) => void;
  onCopyMessage: (text: string) => void;
  onMessageContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onConversationBlankContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  contextMenuState: ContextMenuState | null;
  onCopySelection: () => void;
  onResetConversation: () => void;
  chatScrollAreaRef: RefObject<HTMLDivElement | null>;
  composerInputRef?: RefObject<HTMLTextAreaElement | null>;
  input: string;
  isRunning: boolean;
  lastError: string | null;
  isExportingReport: boolean;
  reportExportNotice: ReportExportNotice | null;
  onExportReport: () => void;
  onOpenPath: (targetPath: string) => void;
  thinkingModeEnabled: boolean;
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onThinkingModeChange: (value: boolean) => void;
  reasoningEffortByModel: Record<string, ReasoningEffort>;
  onModelReasoningEffortChange: (model: string, effort: ReasoningEffort) => void;
  availableModels: string[];
  selectedModel: string;
  modelsLoading: boolean;
  modelsError: string | null;
  onModelChange: (model: string) => void;
  onRefreshModels: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

const VISIBLE_ARTIFACT_TYPES = new Set([
  'debate_config',
  'scoring_table',
  'final_decision',
  'research_config',
  'research_plan',
  'source_list',
  'evidence_table',
  'verification_report',
  'gap_analysis',
  'final_report',
]);

export type ReportExportNotice = { kind: 'success' | 'error'; message: string; filePath?: string };

const ArtifactPanel = memo(function ArtifactPanel({
  artifacts,
  workflowType,
  canExportReport,
  isExportingReport,
  reportExportNotice,
  onExportReport,
  onOpenPath,
}: {
  artifacts: WorkflowArtifact[];
  workflowType: 'debate' | 'deep_research' | 'custom';
  canExportReport: boolean;
  isExportingReport: boolean;
  reportExportNotice: ReportExportNotice | null;
  onExportReport: () => void;
  onOpenPath: (targetPath: string) => void;
}) {
  if (workflowType === 'custom') {
    return (
      <section className="workflow-artifact-panel workflow-empty-panel">
        <p>自定义工作流按节点顺序运行，各智能体的输出会依次显示在左侧消息流中。</p>
      </section>
    );
  }

  const visibleArtifacts = artifacts.filter((artifact) => VISIBLE_ARTIFACT_TYPES.has(artifact.type));

  if (visibleArtifacts.length === 0) {
    return (
      <section className="workflow-artifact-panel workflow-empty-panel">
        <p>{workflowType === 'deep_research' ? '研究开始后，这里会展示计划、来源、证据表和最终报告。' : '辩论开始后，这里会展示配置、评分表和最终裁决。'}</p>
      </section>
    );
  }

  return (
    <section className="workflow-artifact-panel">
      <div className="workflow-artifact-toolbar">
        <span className="workflow-artifact-toolbar-title">阶段产物</span>
        <button
          type="button"
          className="workflow-artifact-export-button"
          onClick={onExportReport}
          disabled={!canExportReport || isExportingReport}
          title={canExportReport ? '把最终报告与过程产物导出为一个 Markdown 文件' : '运行结束后即可导出'}
        >
          <Download size={13} strokeWidth={2} aria-hidden="true" />
          <span>{isExportingReport ? '导出中…' : '导出报告'}</span>
        </button>
      </div>

      {reportExportNotice ? (
        <div className={`workflow-artifact-export-notice${reportExportNotice.kind === 'error' ? ' workflow-artifact-export-notice-error' : ''}`}>
          <span>{reportExportNotice.message}</span>
          {reportExportNotice.filePath ? (
            <button type="button" className="workflow-artifact-export-path" onClick={() => onOpenPath(reportExportNotice.filePath as string)}>
              {reportExportNotice.filePath}
            </button>
          ) : null}
        </div>
      ) : null}

      {visibleArtifacts.map((artifact) => (
        <article key={artifact.id} className="workflow-artifact-card">
          <div className="workflow-artifact-title">{artifact.title}</div>
          <pre>{typeof artifact.data === 'string' ? artifact.data : JSON.stringify(artifact.data, null, 2)}</pre>
        </article>
      ))}
    </section>
  );
});

/**
 * 耗时与 token 放在 console-header 里 —— 它在 console-scroll-area 之外，
 * 不随会话区滚动，所以运行到多久、烧了多少 token 始终一眼可见。
 */
function WorkflowHeaderMetrics({ run }: { run: WorkflowRun | null }) {
  const isRunning = run?.status === 'running';
  const [now, setNow] = useState(() => Date.now());

  // 运行中每秒推进耗时；结束后停掉定时器，用 finishedAt 定格
  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

  if (!run) {
    return null;
  }

  const metrics = run.metrics;
  const startedAt = metrics?.startedAt ?? run.createdAt;
  const endedAt = metrics?.finishedAt ?? (isRunning ? now : run.updatedAt);
  const tokenTitle = metrics
    ? `本地估算值，非模型返回的真实用量\n输入约 ${metrics.promptTokens}，输出约 ${metrics.completionTokens}`
    : '本地估算值，非模型返回的真实用量';

  return (
    <div className="workflow-header-metrics">
      <span className={`workflow-header-metric${isRunning ? ' workflow-header-metric-active' : ''}`}>
        {STATUS_LABELS[run.status] ?? run.status}
      </span>
      <span className="workflow-header-metric" title="从发起本次运行开始计时">
        <Timer size={13} strokeWidth={2} aria-hidden="true" />
        {formatElapsed(endedAt - startedAt)}
      </span>
      <span className="workflow-header-metric" title={tokenTitle}>
        <Coins size={13} strokeWidth={2} aria-hidden="true" />
        约 {formatTokenCount(metrics?.totalTokens ?? 0)} tokens
        {metrics ? ` · ${metrics.modelRequests} 次请求` : ''}
      </span>
    </div>
  );
}

function WorkflowOverview({ run }: { run: WorkflowRun | null }) {
  if (!run) {
    return null;
  }

  return (
    <section className="workflow-overview">
      <div className="workflow-overview-item">
        <GitBranch size={16} />
        <span>{run.currentStageId ? `当前阶段：${run.stages.find((stage) => stage.id === run.currentStageId)?.title ?? run.currentStageId}` : '阶段已结束'}</span>
      </div>
      <div className="workflow-overview-item">
        <Users size={16} />
        <span>{run.actors.map((actor) => `${actor.title}:${STATUS_LABELS[actor.status ?? 'pending'] ?? actor.status}`).join(' / ')}</span>
      </div>
    </section>
  );
}

export function WorkflowConsoleView({
  activeRun,
  workflowArtifacts,
  selectedWorkflowType,
  selectedCustomWorkflowId,
  workflows,
  expandedToolMessageKeys,
  onToggleToolMessage,
  onCopyMessage,
  onMessageContextMenu,
  onConversationBlankContextMenu,
  contextMenuState,
  onCopySelection,
  onResetConversation,
  chatScrollAreaRef,
  composerInputRef,
  input,
  isRunning,
  lastError,
  isExportingReport,
  reportExportNotice,
  onExportReport,
  onOpenPath,
  thinkingModeEnabled,
  onInputChange,
  onSubmit,
  onCancel,
  onThinkingModeChange,
  reasoningEffortByModel,
  onModelReasoningEffortChange,
  availableModels,
  selectedModel,
  modelsLoading,
  modelsError,
  onModelChange,
  onRefreshModels,
  onKeyDown,
}: WorkflowConsoleViewProps) {
  const messages = activeRun?.messages ?? [];
  // 有 activeRun 时以 run.type 为准；无 run 时按侧边栏选中态（含 custom）
  const workflowType: 'debate' | 'deep_research' | 'custom' =
    activeRun?.type === 'custom' ? 'custom'
      : activeRun?.type === 'deep_research' ? 'deep_research'
        : activeRun?.type === 'debate' ? 'debate'
          : selectedWorkflowType;
  const selectedCustomWorkflow = selectedWorkflowType === 'custom'
    ? workflows.find((item) => item.id === selectedCustomWorkflowId) ?? null
    : null;
  const workflowTitle = workflowType === 'custom'
    ? (activeRun?.title ?? selectedCustomWorkflow?.title ?? '自定义工作流')
    : workflowType === 'deep_research' ? '深度研究' : '通用议题辩论';
  const workflowDescription = workflowType === 'custom'
    ? selectedCustomWorkflow?.description || '按画布节点顺序依次调用各智能体，上一节点输出作为下一节点输入。'
    : workflowType === 'deep_research'
      ? 'Planner 拆解子问题后，多个 Researcher 子智能体并行调研；再经证据抽取、事实核验与缺口分析，必要时回环补充，最后由 Synthesizer 出报告。'
      : '程序 Orchestrator 控制阶段，A/B/Critic/Judge 按固定流程协作。';
  const workflowBadge = workflowType === 'custom' ? 'Custom Workflow' : workflowType === 'deep_research' ? 'Deep Research Workflow' : 'Debate Workflow';
  // 这里的输入框只用于「开一轮新的运行」，不是跟已完成的运行继续对话，说清楚避免误发指令
  const composerPlaceholder = workflowType === 'deep_research'
    ? '输入研究议题，开始一轮新的深度研究…（保存报告请用右侧「导出报告」）'
    : workflowType === 'debate'
      ? '输入辩论议题，开始一轮新的辩论…'
      : '输入工作流运行输入，开始一轮新的运行…';
  const WorkflowBadgeIcon = workflowType === 'debate' ? MessagesSquare
    : workflowType === 'deep_research' ? Search
    : workflowType === 'custom' ? WorkflowIcon
    : Scale;

  return (
    <main className="console-panel workflow-console-panel">
      <header className="console-header workflow-header console-divider-bottom">
        <div className="console-agent-badge"><WorkflowBadgeIcon size={18} /></div>
        <div className="console-agent-summary">
          <div className="console-agent-summary-topline">
            <h2>{activeRun?.title ?? workflowTitle}</h2>
            <span className="console-agent-status">{workflowBadge}</span>
          </div>
          <p className="console-agent-description">{workflowDescription}</p>
        </div>
        <WorkflowHeaderMetrics run={activeRun} />
      </header>

      <div className="console-scroll-area" ref={chatScrollAreaRef} onContextMenu={onConversationBlankContextMenu}>
        <div className={`workflow-console-grid${workflowType === 'custom' ? ' workflow-console-grid-single' : ''}`}>
          <div className="workflow-main-column">
            <WorkflowOverview run={activeRun} />
            <div className="console-message-stack">
              <MessageList
                messages={messages}
                expandedToolMessageKeys={expandedToolMessageKeys}
                onToggleToolMessage={onToggleToolMessage}
                onCopyMessage={onCopyMessage}
                onMessageContextMenu={onMessageContextMenu}
              />

              {contextMenuState ? <MessageContextMenu state={contextMenuState} onCopy={onCopySelection} onResetConversation={onResetConversation} /> : null}

              {isRunning || lastError ? (
                <div className="console-inline-panel">
                  <ActivityPanel isRunning={isRunning && !lastError} errorMessage={lastError} />
                </div>
              ) : null}
            </div>
          </div>
          {workflowType === 'custom' ? null : (
            <ArtifactPanel
              artifacts={workflowArtifacts}
              workflowType={workflowType}
              canExportReport={Boolean(activeRun) && !isRunning}
              isExportingReport={isExportingReport}
              reportExportNotice={reportExportNotice}
              onExportReport={onExportReport}
              onOpenPath={onOpenPath}
            />
          )}
        </div>
      </div>

      <Composer
        value={input}
        attachments={[]}
        onAttachmentsChange={() => {}}
        isRunning={isRunning}
        thinkingModeEnabled={thinkingModeEnabled}
        availableModels={availableModels}
        selectedModel={selectedModel}
        modelsLoading={modelsLoading}
        modelsError={modelsError}
        onModelChange={onModelChange}
        onRefreshModels={onRefreshModels}
        onChange={onInputChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
        onThinkingModeChange={onThinkingModeChange}
        reasoningEffortByModel={reasoningEffortByModel}
        onModelReasoningEffortChange={onModelReasoningEffortChange}
        onKeyDown={onKeyDown}
        inputRef={composerInputRef}
        placeholder={composerPlaceholder}
        hideAttachmentButton
      />
    </main>
  );
}
