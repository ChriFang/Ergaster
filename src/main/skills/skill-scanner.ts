/**
 * Skill 静态安全扫描（纯逻辑，无 Electron / fs 依赖，可单测）。
 * 对 SKILL.md 正文与随附文本文件执行规则匹配，产出 findings + 风险分 + 是否阻断。
 */
import type { ScanFinding, ScanReport, SkillMetadata } from '../../shared/user-skills';

export type ScanInput = {
  metadata: SkillMetadata;
  body: string;
  files: { relativePath: string; text?: string }[];
  existingNames: string[];
};

/** frontmatter execute.tool 指向这些工具时按阻断处理。 */
const HIGH_RISK_TOOLS = new Set<string>([
  'run_command', 'run_powershell_template', 'http_request', 'code_write_file', 'code_edit_file',
]);

const SEVERITY_WEIGHT: Record<ScanFinding['severity'], number> = { info: 0, warn: 20, block: 100 };

type ContentRule = { code: string; severity: 'warn' | 'block'; regex: RegExp; message: string };

const CONTENT_RULES: ContentRule[] = [
  { code: 'PIPE_TO_SHELL', severity: 'block', regex: /(curl|wget|iwr|invoke-webrequest)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|invoke-expression|python)\b/i, message: '管道执行远程脚本（pipe-to-shell）' },
  { code: 'DESTRUCTIVE_CMD', severity: 'block', regex: /\brm\s+-rf?\b/i, message: '破坏性删除命令 rm -rf' },
  { code: 'DESTRUCTIVE_CMD', severity: 'block', regex: /remove-item\b[^\n]*-recurse\b[^\n]*-force\b/i, message: '破坏性删除命令 Remove-Item -Recurse -Force' },
  { code: 'DESTRUCTIVE_CMD', severity: 'block', regex: /\bformat\s+[a-z]:/i, message: '磁盘格式化命令' },
  { code: 'DESTRUCTIVE_CMD', severity: 'block', regex: /\bdd\s+if=/i, message: 'dd 覆写命令' },
  { code: 'DESTRUCTIVE_CMD', severity: 'block', regex: /\bmkfs\b/i, message: 'mkfs 文件系统格式化' },
  { code: 'SECRET', severity: 'block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, message: '内嵌私钥' },
  { code: 'SECRET', severity: 'block', regex: /\bAKIA[0-9A-Z]{16}\b/, message: '内嵌 AWS Access Key' },
  { code: 'SECRET', severity: 'warn', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, message: '疑似 GitHub token' },
  { code: 'SECRET', severity: 'warn', regex: /\bsk-[A-Za-z0-9]{20,}\b/, message: '疑似 API 密钥' },
  { code: 'INJECTION', severity: 'warn', regex: /ignore\s+(all\s+)?previous\s+instructions/i, message: '提示注入：忽略先前指令' },
  { code: 'INJECTION', severity: 'warn', regex: /disregard\s+(the\s+)?(above|previous)/i, message: '提示注入：无视上文' },
  { code: 'SUSPICIOUS_NETWORK', severity: 'warn', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/, message: '硬编码 IP 地址' },
  { code: 'BASE64_BLOB', severity: 'warn', regex: /[A-Za-z0-9+/]{200,}={0,2}/, message: '超长 base64 数据块' },
];

/** 对 Skill 全部文本执行规则扫描，汇总 findings、风险分与阻断判定。 */
export function scanSkill(input: ScanInput): ScanReport {
  const findings: ScanFinding[] = [];

  const textTargets: { file: string; text: string }[] = [{ file: 'SKILL.md', text: input.body }];
  for (const f of input.files) {
    if (f.text !== undefined && f.relativePath.toLowerCase() !== 'skill.md') {
      textTargets.push({ file: f.relativePath, text: f.text });
    }
  }

  for (const target of textTargets) {
    for (const rule of CONTENT_RULES) {
      if (rule.regex.test(target.text)) {
        findings.push({ severity: rule.severity, code: rule.code, message: rule.message, file: target.file });
      }
    }
  }

  const exec = input.metadata.metadata?.execute;
  if (exec?.type === 'script') {
    findings.push({ severity: 'block', code: 'EXECUTE_SCRIPT', message: `frontmatter 声明脚本执行：${exec.script?.command ?? ''}`, file: 'SKILL.md' });
  } else if (exec?.type === 'http') {
    findings.push({ severity: 'block', code: 'EXECUTE_HTTP', message: `frontmatter 声明 HTTP 执行：${exec.http?.url ?? ''}`, file: 'SKILL.md' });
  } else if (exec?.type === 'tool') {
    const toolName = exec.tool?.name ?? '';
    if (HIGH_RISK_TOOLS.has(toolName)) {
      findings.push({ severity: 'block', code: 'EXECUTE_TOOL_HIGH', message: `frontmatter 调用高危工具：${toolName}`, file: 'SKILL.md' });
    } else {
      findings.push({ severity: 'warn', code: 'EXECUTE_TOOL', message: `frontmatter 声明工具调用：${toolName}`, file: 'SKILL.md' });
    }
  }

  const name = input.metadata.name ?? '';
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
    findings.push({ severity: 'block', code: 'INVALID_NAME', message: `名称不合法：${name}`, file: 'SKILL.md' });
  }
  if (/[^\x00-\x7f]/.test(name)) {
    findings.push({ severity: 'warn', code: 'NON_ASCII_NAME', message: '名称含非 ASCII 字符（可能同形字混淆）', file: 'SKILL.md' });
  }
  for (const existing of input.existingNames) {
    if (existing !== name && name.length > 0 && levenshtein(existing, name) === 1) {
      findings.push({ severity: 'warn', code: 'TYPOSQUAT', message: `名称与既有 Skill「${existing}」高度相似，疑似仿冒`, file: 'SKILL.md' });
      break;
    }
  }

  const score = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  const blocked = findings.some((f) => f.severity === 'block');
  return { score, findings, blocked };
}

/** 标准滚动数组编辑距离，用于 typosquat 近似判定。 */
function levenshtein(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1));
      prevDiag = temp;
    }
  }
  return dp[b.length];
}

