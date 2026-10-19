import type { DeepResearchConfig, DeepResearchRunInput } from '../../../shared/workflow';

export function createDefaultDeepResearchConfig(input: DeepResearchRunInput): DeepResearchConfig {
  const depth = input.depth ?? 'standard';
  return {
    topic: input.topic,
    scope: input.scope,
    depth,
    sourcePreference: input.sourcePreference ?? 'mixed',
    maxSearchRounds: input.maxSearchRounds ?? (depth === 'deep' ? 3 : depth === 'quick' ? 1 : 2),
    evidenceRequirement: depth === 'quick' ? 'medium' : 'high',
    actors: ['planner', 'researcher', 'evidence_extractor', 'fact_checker', 'gap_analyzer', 'synthesizer'],
    stages: ['plan', 'collect', 'extract', 'verify', 'gap', 'synthesize'],
  };
}

function formatConfig(config: DeepResearchConfig, constraints?: string) {
  return [
    `研究主题：${config.topic}`,
    `研究范围：${config.scope || '未指定'}`,
    `研究深度：${config.depth}`,
    `来源偏好：${config.sourcePreference}`,
    `最大检索轮次：${config.maxSearchRounds}`,
    `证据要求：${config.evidenceRequirement}`,
    `额外约束：${constraints || '无'}`,
  ].join('\n');
}

export function buildResearchPlannerPrompt(config: DeepResearchConfig, constraints?: string) {
  return `你是 Deep Research 工作流中的 Research Planner。\n\n${formatConfig(config, constraints)}\n\n你的任务是制定研究计划，不要编造最终结论。请拆解研究问题，明确子问题、研究路径、证据标准和潜在风险。\n\n输出格式：\n【研究问题】\n...\n\n【子问题】\n- ...\n\n【研究路径】\n- ...\n\n【证据标准】\n- ...\n\n【预期来源类型】\n- ...\n\n【主要风险】\n- ...\n\n【子任务清单】\n最后必须输出可并行执行的调研子任务，最多 ${maxSubtaskCount(config)} 条。每条独占一行，严格使用竖线分隔的三段格式，不要加序号符号或额外说明：\nSQ1 | 子任务标题 | 自包含的调研指令（不要引用本计划的其他部分，执行者看不到计划全文）\nSQ2 | ... | ...`;
}

/** 按研究深度限制并行子任务数量，避免一次 fan-out 派发过多子智能体。 */
export function maxSubtaskCount(config: DeepResearchConfig) {
  if (config.depth === 'quick') {
    return 2;
  }

  return config.depth === 'deep' ? 6 : 4;
}

export type ResearchSubtask = {
  id: string;
  title: string;
  instruction: string;
};

/**
 * 从 planner 输出中解析【子任务清单】。
 * 解析失败时返回空数组，调用方需回退到单个 researcher 的旧路径。
 */
export function parseResearchSubtasks(planContent: string, limit: number): ResearchSubtask[] {
  const sectionIndex = planContent.indexOf('【子任务清单】');
  const section = sectionIndex >= 0 ? planContent.slice(sectionIndex + '【子任务清单】'.length) : planContent;
  const subtasks: ResearchSubtask[] = [];
  const seenIds = new Set<string>();

  for (const rawLine of section.split('\n')) {
    const line = rawLine.replace(/^[\s\-*•]+/, '').trim();
    if (!line || line.startsWith('【')) {
      continue;
    }

    const parts = line.split('|').map((part) => part.trim());
    if (parts.length < 3) {
      continue;
    }

    const [id, title, ...rest] = parts;
    if (!/^SQ\d+$/i.test(id)) {
      continue;
    }

    const normalizedId = id.toUpperCase();
    const instruction = rest.join(' | ').trim();
    if (!title || !instruction || seenIds.has(normalizedId)) {
      continue;
    }

    seenIds.add(normalizedId);
    subtasks.push({ id: normalizedId, title, instruction });

    if (subtasks.length >= limit) {
      break;
    }
  }

  return subtasks;
}

/** 单个并行调研子任务派发给子智能体的自包含指令。 */
export function buildResearchSubtaskPrompt(config: DeepResearchConfig, subtask: ResearchSubtask) {
  return `总体研究主题：${config.topic}\n研究范围：${config.scope || '未指定'}\n来源偏好：${config.sourcePreference}\n证据要求：${config.evidenceRequirement}\n\n你负责的子任务【${subtask.id} ${subtask.title}】：\n${subtask.instruction}\n\n只调研这一个子任务，不要扩展到其他子问题。可以调用已授权的只读工具（http_request、read_file、search_files）收集资料。\n\n输出格式：\n【子任务】${subtask.id} ${subtask.title}\n\n【资料收集说明】\n说明使用了哪些工具与来源，以及仍需验证的限制。\n\n【候选来源】\n- 来源ID：${subtask.id}-S1\n  - 标题/类型：\n  - 可能发布方：\n  - 摘要：\n  - 可靠性：low/medium/high\n\n【关键资料摘要】\n- ...\n\n【需要外部验证的信息】\n- ...`;
}

/** 补充轮调研：只针对缺口分析指出的缺失信息。 */
export function buildSupplementalResearchPrompt(config: DeepResearchConfig, gap: string, round: number) {
  return `总体研究主题：${config.topic}\n来源偏好：${config.sourcePreference}\n\n这是第 ${round} 轮补充调研。上一轮的缺口分析结论：\n${gap}\n\n只针对上述缺口收集补充资料，不要重复已经充分覆盖的内容。可以调用已授权的只读工具收集资料。\n\n输出格式：\n【补充资料收集说明】\n...\n\n【新增候选来源】\n- 来源ID：R${round}-S1\n  - 标题/类型：\n  - 可能发布方：\n  - 摘要：\n  - 可靠性：low/medium/high\n\n【仍未解决的缺口】\n- ...`;
}

/** 从缺口分析中读取"是否建议追加一轮"。 */
export function shouldRunAnotherResearchRound(gapContent: string) {
  const marker = '【是否建议追加一轮】';
  const markerIndex = gapContent.indexOf(marker);
  if (markerIndex < 0) {
    return false;
  }

  const rest = gapContent.slice(markerIndex + marker.length);
  const answer = rest.split('【')[0]?.replace(/\s/g, '') ?? '';
  if (!answer) {
    return false;
  }

  return answer.startsWith('是');
}

export function buildResearcherPrompt(config: DeepResearchConfig, plan: string, constraints?: string) {
  return `你是 Deep Research 工作流中的 Researcher。\n\n${formatConfig(config, constraints)}\n\n研究计划：\n${plan}\n\n你可以在需要时调用已授权的只读工具收集资料，例如 http_request、read_file、search_files。优先使用公开 URL 或本地可读资料；如果没有足够来源，必须明确标记需要进一步验证。\n\n输出格式：\n【资料收集说明】\n说明是否使用了工具、使用了哪些来源，以及仍需验证的限制。\n\n【候选来源】
\n- 来源ID：S1\n  - 标题/类型：\n  - 可能发布方：\n  - 摘要：\n  - 可靠性：low/medium/high\n\n【关键资料摘要】\n- ...\n\n【需要外部验证的信息】\n- ...`;
}

export function buildEvidenceExtractorPrompt(config: DeepResearchConfig, plan: string, sources: string) {
  return `你是 Deep Research 工作流中的 Evidence Extractor。\n\n研究主题：${config.topic}\n\n研究计划：\n${plan}\n\n资料收集结果：\n${sources}\n\n请从资料中抽取结构化证据。不要新增资料中没有的事实。\n\n输出格式：\n【证据表】\n- 证据ID：E1\n  - Claim：\n  - Evidence：\n  - SourceIds：\n  - Confidence：low/medium/high\n  - Limitations：\n\n【证据缺口】\n- ...`;
}

export function buildFactCheckerPrompt(config: DeepResearchConfig, evidence: string, sources: string) {
  return `你是 Deep Research 工作流中的 Fact Checker。\n\n研究主题：${config.topic}\n\n资料收集结果：\n${sources}\n\n证据表：\n${evidence}\n\n请检查证据可靠性、冲突点、高风险断言和需要外部验证的内容。你可以在需要时调用已授权的只读工具做补充核验，但不要声称已经验证未实际检查的事实。\n\n输出格式：
\n【已较充分支持的结论】\n- ...\n\n【证据薄弱的结论】\n- ...\n\n【潜在冲突或不一致】\n- ...\n\n【高风险断言】\n- ...\n\n【建议补充核验】\n- ...`;
}

export function buildGapAnalyzerPrompt(config: DeepResearchConfig, verification: string, evidence: string) {
  return `你是 Deep Research 工作流中的 Gap Analyzer。\n\n研究主题：${config.topic}\n证据要求：${config.evidenceRequirement}\n\n核验报告：\n${verification}\n\n证据表：\n${evidence}\n\n请判断当前证据是否足以生成报告，并指出缺口。\n\n输出格式：\n【是否足够】\n是 / 否 / 部分足够\n\n【缺失信息】\n- ...\n\n【建议下一轮查询】\n- ...\n\n【是否建议追加一轮】\n是 / 否\n\n【原因】\n...`;
}

export function buildSynthesizerPrompt(config: DeepResearchConfig, payload: {
  plan: string;
  sources: string;
  evidence: string;
  verification: string;
  gap: string;
}) {
  return `你是 Deep Research 工作流中的 Synthesizer。\n\n研究主题：${config.topic}\n研究范围：${config.scope || '未指定'}\n\n研究计划：\n${payload.plan}\n\n资料收集：\n${payload.sources}\n\n证据表：\n${payload.evidence}\n\n核验报告：\n${payload.verification}\n\n缺口分析：\n${payload.gap}\n\n请只基于上述材料生成最终研究报告。必须明确说明哪些结论来自工具或资料，哪些仍需要进一步验证。\n\n输出格式：
\n【标题】\n...\n\n【执行摘要】\n...\n\n【关键发现】\n- ...\n\n【详细分析】\n...\n\n【不确定性与限制】\n- ...\n\n【结论】\n...\n\n【建议后续验证】\n- ...`;
}
