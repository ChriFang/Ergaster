import type { ToolRisk } from '../../shared/tools';

/**
 * 破坏性动作：直接删数据、终止进程、重置状态。命中即 high，弹确认后才能执行。
 * 用词边界匹配，避免 "format" 误伤 "information"、"reset" 误伤 "presetting"。
 */
const highRiskPatterns: RegExp[] = [
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bdrop\b/i,
  /\btruncate\b/i,
  /\bdestroy\b/i,
  /\bformat\b/i,
  /\breset\b/i,
  /\bshutdown\b/i,
  /\brestart\b/i,
  /\bkill\b/i,
  /\bterminate\b/i,
  /\bpurge\b/i,
  /\bwipe\b/i,
  /\buninstall\b/i,
];

/** 变更类动作：写入、移动、对外发送、执行任意代码。命中升 medium。 */
const mediumRiskPatterns: RegExp[] = [
  /\bwrite\b/i,
  /\bcreate\b/i,
  /\bupdate\b/i,
  /\bedit\b/i,
  /\bpatch\b/i,
  /\bsave\b/i,
  /\binsert\b/i,
  /\bmove\b/i,
  /\brename\b/i,
  /\bcopy\b/i,
  /\bupload\b/i,
  /\bsend\b/i,
  /\bpost\b/i,
  /\bpublish\b/i,
  /\bdeploy\b/i,
  /\bcommit\b/i,
  /\bpush\b/i,
  /\bmerge\b/i,
  /\binstall\b/i,
  /\bexec(ute)?\b/i,
  /\brun\b/i,
  /\bshell\b/i,
  /\bspawn\b/i,
  /\bsubmit\b/i,
];

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * 工具名常见 snake_case / camelCase / 点分格式，直接用 \b 会因 "_" 属于词字符
 * 而漏判（\bdelete\b 不匹配 delete_issue）。先把常见分隔符归一成空格再匹配。
 */
function normalizeToolNameForMatching(toolName: string) {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-./]+/g, ' ');
}

/**
 * 按工具名与描述启发式判定 MCP 工具的风险等级。
 *
 * MCP 工具由外部服务声明，应用无法确知其实际行为，此前一律按 low 处理
 * 意味着任何破坏性工具都会免确认直接执行。这里宁可保守：工具名权重高于描述，
 * 破坏性词命中即 high，变更类词命中升 medium，只有明显只读的才保持 low。
 */
export function assessMcpToolRisk(input: { toolName: string; description?: string }): ToolRisk {
  const toolName = normalizeToolNameForMatching(input.toolName.trim());
  const description = input.description?.trim() ?? '';

  if (matchesAny(toolName, highRiskPatterns)) {
    return 'high';
  }

  if (matchesAny(toolName, mediumRiskPatterns)) {
    return 'medium';
  }

  if (matchesAny(description, highRiskPatterns)) {
    return 'high';
  }

  if (matchesAny(description, mediumRiskPatterns)) {
    return 'medium';
  }

  return 'low';
}
