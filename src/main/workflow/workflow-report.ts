import type { WorkflowArtifact, WorkflowRun, WorkflowType } from '../../shared/workflow';
import { sanitizeFileName } from '../tools/tool-helpers';

const WORKFLOW_TYPE_LABELS: Record<WorkflowType, string> = {
  chat: '对话',
  debate: '通用议题辩论',
  deep_research: '深度研究',
  simulation: '仿真',
  forecast: '预测',
  custom: '自定义工作流',
};

const RUN_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  configured: '已配置',
  running: '运行中',
  waiting_user: '等待确认',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/** 作为报告正文的产物类型：深度研究是最终报告，辩论是最终裁决。 */
const PRIMARY_ARTIFACT_TYPES = ['final_report', 'final_decision'];

function formatTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatFileTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function renderArtifactBody(artifact: WorkflowArtifact) {
  if (typeof artifact.data === 'string') {
    return artifact.data.trim() || '_（无内容）_';
  }

  return ['```json', JSON.stringify(artifact.data, null, 2), '```'].join('\n');
}

function getTopic(run: WorkflowRun) {
  const topic = (run.inputs as { topic?: unknown }).topic;
  return typeof topic === 'string' && topic.trim() ? topic.trim() : '';
}

/**
 * 把一次工作流运行导出成单个 Markdown 文档：正文用最终报告/裁决，
 * 中间产物（计划、来源、证据、核验、缺口）按生成顺序放进附录。
 * 纯函数，不触碰文件系统，便于单测。
 */
export function buildWorkflowReportMarkdown(run: WorkflowRun, exportedAt: number) {
  const topic = getTopic(run);
  const primary = PRIMARY_ARTIFACT_TYPES
    .flatMap((type) => run.artifacts.filter((artifact) => artifact.type === type));
  const primaryIds = new Set(primary.map((artifact) => artifact.id));
  const appendix = run.artifacts.filter((artifact) => !primaryIds.has(artifact.id));

  const lines: string[] = [
    `# ${run.title}`,
    '',
    `- 类型：${WORKFLOW_TYPE_LABELS[run.type] ?? run.type}`,
    `- 状态：${RUN_STATUS_LABELS[run.status] ?? run.status}`,
  ];

  if (topic) {
    lines.push(`- 议题：${topic}`);
  }

  lines.push(
    `- 创建时间：${formatTimestamp(run.createdAt)}`,
    `- 导出时间：${formatTimestamp(exportedAt)}`,
    '',
  );

  if (run.error) {
    lines.push(`> 本次运行未正常结束：${run.error}`, '');
  }

  if (primary.length === 0) {
    lines.push('> 本次运行没有产出最终报告，以下仅为已完成阶段的中间产物。', '');
  }

  for (const artifact of primary) {
    lines.push(`## ${artifact.title}`, '', renderArtifactBody(artifact), '');
  }

  if (appendix.length > 0) {
    lines.push('---', '', '## 附录：过程产物', '');

    for (const artifact of appendix) {
      lines.push(`### ${artifact.title}`, '', renderArtifactBody(artifact), '');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** 默认保存文件名：类型 + 议题 + 导出时间，已做非法字符替换。 */
export function buildWorkflowReportFileName(run: WorkflowRun, exportedAt: number) {
  const typeLabel = WORKFLOW_TYPE_LABELS[run.type] ?? run.type;
  const topic = getTopic(run) || run.title;
  const shortTopic = topic.replace(/\s+/g, ' ').trim().slice(0, 40);
  const parts = [typeLabel, shortTopic, formatFileTimestamp(exportedAt)].filter(Boolean);
  return `${sanitizeFileName(parts.join('-'))}.md`;
}
