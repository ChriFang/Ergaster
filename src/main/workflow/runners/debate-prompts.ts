import type { DebateConfig, DebateRubricItem } from '../../../shared/workflow';

const DEFAULT_RUBRICS: Record<DebateConfig['topicType'], DebateRubricItem[]> = {
  fact_judgement: [
    { name: '证据充分性', weight: 35, description: '是否有足够事实依据支撑结论' },
    { name: '逻辑一致性', weight: 25, description: '推理链条是否自洽' },
    { name: '反例处理', weight: 20, description: '是否能解释重要反例' },
    { name: '结论边界', weight: 20, description: '是否明确适用范围和不确定性' },
  ],
  option_selection: [
    { name: '目标匹配度', weight: 25, description: '是否最符合用户目标' },
    { name: '成本收益比', weight: 25, description: '收益是否值得投入成本' },
    { name: '风险可控性', weight: 20, description: '失败风险是否可控' },
    { name: '落地可行性', weight: 20, description: '当前条件下是否能执行' },
    { name: '扩展空间', weight: 10, description: '未来是否有继续演进空间' },
  ],
  strategy_decision: [
    { name: '目标匹配度', weight: 25, description: '是否服务于核心战略目标' },
    { name: '机会成本', weight: 20, description: '是否合理处理资源取舍' },
    { name: '收益风险比', weight: 25, description: '收益是否匹配风险与投入' },
    { name: '时机判断', weight: 15, description: '当前时点是否适合执行' },
    { name: '可执行性', weight: 15, description: '组织、资源和路径是否可落地' },
  ],
  value_debate: [
    { name: '立场清晰度', weight: 20, description: '观点是否明确且不摇摆' },
    { name: '论证质量', weight: 30, description: '理由是否充分、有层次' },
    { name: '反驳力度', weight: 20, description: '是否有效回应对立观点' },
    { name: '价值权衡', weight: 20, description: '是否承认并处理不同价值取舍' },
    { name: '适用边界', weight: 10, description: '是否说明观点适用条件' },
  ],
  software_design: [
    { name: '架构正确性', weight: 25, description: '是否满足系统目标和约束' },
    { name: '实现复杂度', weight: 15, description: '实现、调试、测试成本是否可控' },
    { name: '可扩展性', weight: 15, description: '未来扩展是否顺畅' },
    { name: '可维护性', weight: 15, description: '模块边界和长期维护是否合理' },
    { name: '性能与容量', weight: 10, description: '性能瓶颈和容量风险是否可控' },
    { name: '可靠性', weight: 10, description: '容错、回滚、降级是否完善' },
    { name: '安全与一致性', weight: 10, description: '权限、数据一致性和误用风险是否可控' },
  ],
  product_design: [
    { name: '用户价值', weight: 30, description: '是否真正解决核心用户痛点' },
    { name: '业务收益', weight: 20, description: '是否支持增长、留存、转化或成本优化' },
    { name: '实现成本', weight: 15, description: '产品、设计、研发、运营成本是否合理' },
    { name: '风险可控性', weight: 15, description: '体验、合规、舆情、依赖风险是否可控' },
    { name: '落地速度', weight: 10, description: '是否适合当前周期上线' },
    { name: '可扩展性', weight: 10, description: '后续迭代空间是否足够' },
  ],
};

export function createDefaultDebateConfig(topic: string, constraints?: string): DebateConfig {
  const normalized = `${topic} ${constraints ?? ''}`;
  let topicType: DebateConfig['topicType'] = 'option_selection';
  if (/事实|真假|是否存在|有没有证据|一定会|必然/.test(normalized)) {
    topicType = 'fact_judgement';
  } else if (/架构|代码|软件|系统|接口|模块|RPC|数据库|服务|技术|实现/.test(normalized)) {
    topicType = 'software_design';
  } else if (/产品|用户|体验|功能|增长|留存|转化/.test(normalized)) {
    topicType = 'product_design';
  } else if (/战略|策略|公司|市场|增长|盈利|资源/.test(normalized)) {
    topicType = 'strategy_decision';
  } else if (/是否|应该|好不好|价值|管理|文化/.test(normalized)) {
    topicType = 'value_debate';
  }

  return {
    topic,
    topicType,
    debateMode: topicType === 'option_selection' ? 'compare' : 'debate',
    stanceMode: 'pro_con',
    needFactChecker: topicType === 'fact_judgement',
    needDomainExpert: topicType === 'software_design' || topicType === 'product_design',
    recommendedAgents: ['AgentA', 'AgentB', 'Critic', 'Judge'],
    agentPersonas: {
      AgentA: '支持议题中的主张，强调收益、机会、长期价值和可行路径',
      AgentB: '反对或审慎看待议题中的主张，强调成本、风险、替代方案和边界条件',
      Critic: '审查双方论证漏洞、隐藏前提、反例、风险和证据不足点',
      Judge: '按照评分标准做条件式裁决，输出可采纳结论和待验证项',
    },
    rubric: DEFAULT_RUBRICS[topicType],
    evidenceRequirement: topicType === 'fact_judgement' ? 'high' : 'medium',
    maxRounds: 1,
    debateThreshold: 8,
    outputStyle: topicType === 'software_design' ? 'adr' : 'decision_record',
    clarifyingQuestions: [],
  };
}

export function formatRubric(rubric: DebateRubricItem[]) {
  return rubric.map((item) => `- ${item.name}：${item.weight} 分，${item.description}`).join('\n');
}

export function buildClassifierPrompt(topic: string, constraints?: string) {
  return `你是通用辩论系统中的 Topic Classifier。\n\n请根据用户议题判断辩论类型，并输出简洁 JSON。\n\n议题：${topic}\n补充约束：${constraints || '无'}\n\n可选 topicType：fact_judgement、option_selection、strategy_decision、value_debate、software_design、product_design。\n\n请输出字段：topicType、debateMode、stanceMode、evidenceRequirement、outputStyle、clarifyingQuestions。不要输出额外解释。`;
}

export function buildProposalPrompt(config: DebateConfig, actorId: 'AgentA' | 'AgentB', constraints?: string) {
  return `你是通用议题辩论中的 ${actorId}。\n\n议题：${config.topic}\n补充约束：${constraints || '无'}\n议题类型：${config.topicType}\n你的角色倾向：${config.agentPersonas[actorId]}\n\n评分标准：\n${formatRubric(config.rubric)}\n\n请独立提出你的立场，不要引用其他 agent。\n\n输出格式：\n【核心结论】\n...\n\n【主要论据】\n- 论据1：\n- 论据2：\n- 论据3：\n\n【适用条件】\n...\n\n【风险与反例】\n...\n\n【关键假设】\n...\n\n【待确认信息】\n...\n\n【置信度】\n0-100`;
}

export function buildCriticPrompt(config: DebateConfig, proposalA: string, proposalB: string) {
  return `你是通用议题辩论中的 Critic。\n\n议题：${config.topic}\n议题类型：${config.topicType}\n你的角色倾向：${config.agentPersonas.Critic}\n\nAgentA 观点：\n${proposalA}\n\nAgentB 观点：\n${proposalB}\n\n评分标准：\n${formatRubric(config.rubric)}\n\n你的任务不是提出第三个完整方案，而是审查 A/B 的缺陷。\n\n输出格式：\n【对 AgentA 的批判】\n- 最强问题：\n- 隐藏前提：\n- 被忽略的反例：\n- 风险或副作用：\n- 需要补证据的点：\n\n【对 AgentB 的批判】\n- 最强问题：\n- 隐藏前提：\n- 被忽略的反例：\n- 风险或副作用：\n- 需要补证据的点：\n\n【横向比较】\n- 更稳健的一方：\n- 更激进的一方：\n- 更依赖假设的一方：\n- 更值得继续辩论的问题：\n\n【建议下一轮聚焦】\n1. ...\n2. ...\n3. ...`;
}

export function buildRevisionPrompt(config: DebateConfig, actorId: 'AgentA' | 'AgentB', proposal: string, critique: string) {
  return `你是通用议题辩论中的 ${actorId}。\n\n议题：${config.topic}\n你的原始观点：\n${proposal}\n\nCritic 的批判意见：\n${critique}\n\n请只回应关键问题，不要完全重写。若问题成立，直接承认并给出修正措施。\n\n输出格式：\n【保留不变的核心主张】\n...\n\n【对关键质疑的回应】\n- 质疑1：\n  - 是否成立：\n  - 回应：\n  - 修正措施：\n\n【修正版结论】\n...\n\n【新增代价或限制】\n...\n\n【仍然存在的风险】\n...\n\n【最终主张】\n...`;
}

export function buildJudgePrompt(config: DebateConfig, proposalA: string, proposalB: string, critique: string, revisionA: string, revisionB: string) {
  return `你是通用议题辩论系统中的 Judge。\n\n议题：${config.topic}\n议题类型：${config.topicType}\n裁决重点：${config.agentPersonas.Judge}\n\n评分标准：\n${formatRubric(config.rubric)}\n\nAgentA 初始观点：\n${proposalA}\n\nAgentB 初始观点：\n${proposalB}\n\nCritic 批判：\n${critique}\n\nAgentA 修正：\n${revisionA}\n\nAgentB 修正：\n${revisionB}\n\n请严格按 rubric 评分，不根据表达流畅度加分。若双方适用场景不同，输出条件式结论。\n\n输出格式：\n【评分结果】\nAgentA：\n- 按评分项逐项给分\n- 总分：\n\nAgentB：\n- 按评分项逐项给分\n- 总分：\n\n【裁决结论】\n- 推荐结论：\n- 选择原因：\n- 不选择另一方的原因：\n\n【条件式判断】\n如果满足以下条件，推荐 A：\n...\n\n如果满足以下条件，推荐 B：\n...\n\n【仍需验证】\n...\n\n【是否继续下一轮】\n- 是 / 否\n- 原因：\n- 下一轮只讨论：`;
}
