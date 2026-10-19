import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowArtifact, WorkflowRun } from '../../shared/workflow';
import { buildWorkflowReportFileName, buildWorkflowReportMarkdown } from './workflow-report';

const EXPORTED_AT = new Date(2026, 8, 3, 16, 45).getTime();
const CREATED_AT = new Date(2026, 8, 3, 16, 0).getTime();

function artifact(type: string, title: string, data: unknown): WorkflowArtifact {
  return {
    id: `artifact-${type}`,
    runId: 'run-1',
    workflowType: 'deep_research',
    type,
    title,
    data,
    createdAt: CREATED_AT,
  };
}

function buildRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    type: 'deep_research',
    title: '深度研究：向量数据库选型',
    status: 'completed',
    createdAt: CREATED_AT,
    updatedAt: EXPORTED_AT,
    inputs: { topic: '向量数据库选型' },
    config: {},
    actors: [],
    stages: [],
    messages: [],
    artifacts: [
      artifact('research_config', '研究配置', { depth: 'standard', maxSearchRounds: 2 }),
      artifact('research_plan', '研究计划', '【研究问题】\n如何选型'),
      artifact('final_report', '最终研究报告', '【结论】\n选 A'),
    ],
    ...overrides,
  };
}

test('buildWorkflowReportMarkdown 把最终报告放正文、其余产物放附录', () => {
  const markdown = buildWorkflowReportMarkdown(buildRun(), EXPORTED_AT);

  assert.ok(markdown.startsWith('# 深度研究：向量数据库选型\n'));
  assert.ok(markdown.includes('- 类型：深度研究'));
  assert.ok(markdown.includes('- 状态：已完成'));
  assert.ok(markdown.includes('- 议题：向量数据库选型'));

  const reportIndex = markdown.indexOf('## 最终研究报告');
  const appendixIndex = markdown.indexOf('## 附录：过程产物');
  const planIndex = markdown.indexOf('### 研究计划');

  assert.ok(reportIndex > 0, '应包含最终报告小节');
  assert.ok(appendixIndex > reportIndex, '附录应排在正文之后');
  assert.ok(planIndex > appendixIndex, '研究计划应在附录内');
  assert.ok(markdown.includes('【结论】\n选 A'));
  assert.ok(markdown.endsWith('\n'));
});

test('buildWorkflowReportMarkdown 对非字符串产物输出 json 代码块', () => {
  const markdown = buildWorkflowReportMarkdown(buildRun(), EXPORTED_AT);

  assert.ok(markdown.includes('```json'));
  assert.ok(markdown.includes('"maxSearchRounds": 2'));
});

test('buildWorkflowReportMarkdown 没有最终报告时给出提示', () => {
  const run = buildRun({
    status: 'cancelled',
    artifacts: [artifact('research_plan', '研究计划', '仅有计划')],
  });

  const markdown = buildWorkflowReportMarkdown(run, EXPORTED_AT);

  assert.ok(markdown.includes('本次运行没有产出最终报告'));
  assert.ok(markdown.includes('- 状态：已取消'));
  assert.equal(markdown.includes('## 最终研究报告'), false);
});

test('buildWorkflowReportMarkdown 会带上运行失败原因', () => {
  const markdown = buildWorkflowReportMarkdown(buildRun({ status: 'failed', error: '模型服务超时' }), EXPORTED_AT);

  assert.ok(markdown.includes('> 本次运行未正常结束：模型服务超时'));
});

test('buildWorkflowReportMarkdown 空内容产物标注为无内容', () => {
  const run = buildRun({ artifacts: [artifact('final_report', '最终研究报告', '   ')] });

  assert.ok(buildWorkflowReportMarkdown(run, EXPORTED_AT).includes('_（无内容）_'));
});

test('buildWorkflowReportMarkdown 辩论的最终裁决同样作为正文', () => {
  const run = buildRun({
    type: 'debate',
    title: '辩论：是否自研',
    inputs: { topic: '是否自研' },
    artifacts: [
      artifact('scoring_table', '评分表', '打分'),
      artifact('final_decision', '最终裁决', '建议自研'),
    ],
  });

  const markdown = buildWorkflowReportMarkdown(run, EXPORTED_AT);

  assert.ok(markdown.includes('- 类型：通用议题辩论'));
  assert.ok(markdown.indexOf('## 最终裁决') < markdown.indexOf('## 附录：过程产物'));
});

test('buildWorkflowReportFileName 拼接类型、议题与时间戳', () => {
  assert.equal(buildWorkflowReportFileName(buildRun(), EXPORTED_AT), '深度研究-向量数据库选型-20260903-1645.md');
});

test('buildWorkflowReportFileName 替换非法字符并截断超长议题', () => {
  const run = buildRun({ inputs: { topic: `a/b:c*${'长'.repeat(60)}` } });
  const fileName = buildWorkflowReportFileName(run, EXPORTED_AT);

  assert.equal(/[\\/:*?"<>|]/.test(fileName), false, '不应残留非法字符');
  assert.ok(fileName.startsWith('深度研究-a_b_c_'));
  assert.ok(fileName.endsWith('-20260903-1645.md'));
});

test('buildWorkflowReportFileName 缺少 topic 时回退到 run.title', () => {
  const run = buildRun({ inputs: {} });

  // 全角冒号不在 sanitizeFileName 的替换集里，各平台都是合法文件名字符，按原样保留
  assert.equal(buildWorkflowReportFileName(run, EXPORTED_AT), '深度研究-深度研究：向量数据库选型-20260903-1645.md');
});
