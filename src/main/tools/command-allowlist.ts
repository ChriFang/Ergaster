/**
 * 命令自动执行白名单判定（纯函数、零依赖）。
 *
 * 定位：白名单是效率优化，不是安全边界——任何检测不确定的情形一律回落弹窗。
 * 判定链（run_command 执行前）：
 *   1. 命中用户黑名单          → confirm（deny 优先）
 *   2. 含危险模式（防绕过检测） → confirm（优先级高于白名单）
 *   3. 命中内置只读清单         → 继续判定其余语句段 / 管道子段
 *   4. 命中用户白名单（前缀）   → 继续判定其余语句段 / 管道子段
 *   5. 都未命中                → confirm
 * 全部语句段（含管道子段）命中 3/4 才 auto。
 */

import type { ToolSettings } from '../../shared/config';
import { BUILTIN_READONLY_COMMANDS, DANGEROUS_COMMANDS, SCRIPT_BLOCK_TOLERATED_COMMANDS } from '../../shared/command-builtin-list';

export type CommandAutoRunDecision = 'auto' | 'confirm';

export type CommandAutoRunResult = {
  decision: CommandAutoRunDecision;
  /** 命中/拒绝原因，用于审计日志与确认卡 detail。 */
  reason: string;
};

type CommandListConfig = Pick<ToolSettings, 'commandAllowlist' | 'commandDenylist'>;

function isWhitespace(ch: string) {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}

/**
 * 引号感知地跳过单双引号与脚本块 `{ }`，返回出现指定顶层分隔符的位置索引（未找到返回 -1）。
 * 分隔符匹配按原样（不区分大小写无意义，分隔符均为符号）。
 */
function findTopLevelSeparator(text: string, separators: readonly string[], from = 0): number {
  let i = from;
  let inSingle = false;
  let inDouble = false;
  let braceDepth = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inSingle) {
      if (ch === "'") {
        // PowerShell 单引号内 '' 表示字面单引号
        if (text[i + 1] === "'") {
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i += 1;
      continue;
    }
    if (inDouble) {
      if (ch === '`') {
        // 双引号内反引号转义
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      i += 1;
      continue;
    }
    if (braceDepth > 0) {
      if (ch === '{') {
        braceDepth += 1;
      } else if (ch === '}') {
        braceDepth -= 1;
      } else if (ch === "'") {
        inSingle = true;
      } else if (ch === '"') {
        inDouble = true;
      }
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i += 1;
      continue;
    }
    if (ch === '`') {
      // 转义下一字符（危险模式会单独检测反引号，此处 lexer 仅跳过）
      i += 2;
      continue;
    }
    if (ch === '{') {
      braceDepth += 1;
      i += 1;
      continue;
    }
    for (const sep of separators) {
      if (text.startsWith(sep, i)) {
        return i;
      }
    }
    i += 1;
  }
  return -1;
}

/** 按顶层 `;`、换行、`&&`、`||` 拆分语句段（引号/脚本块内不拆）。 */
function splitStatements(command: string): string[] {
  const separators = ['&&', '||', ';', '\r\n', '\n', '\r'];
  const segments: string[] = [];
  let rest = command.trim();

  while (rest.length > 0) {
    const idx = findTopLevelSeparator(rest, separators);
    if (idx === -1) {
      segments.push(rest.trim());
      break;
    }
    segments.push(rest.slice(0, idx).trim());
    let next = rest.slice(idx + (rest.startsWith('&&', idx) || rest.startsWith('||', idx) ? 2 : 1));
    // 消费掉换行后的缩进
    next = next.replace(/^[\s]+/, '');
    rest = next;
  }

  return segments.filter((seg) => seg.length > 0);
}

/** 语句段内按顶层 `|` 拆管道子段（引号/脚本块内不拆）。`|` 后紧跟 `|` 属语句分隔残留，逐字符拆段后靠 trim 过滤空段。 */
function splitPipeline(segment: string): string[] {
  const parts: string[] = [];
  let rest = segment.trim();

  while (rest.length > 0) {
    const idx = findTopLevelSeparator(rest, ['|']);
    if (idx === -1) {
      parts.push(rest.trim());
      break;
    }
    parts.push(rest.slice(0, idx).trim());
    rest = rest.slice(idx + 1).replace(/^[\s]+/, '');
  }

  return parts.filter((part) => part.length > 0);
}

/** 单语句段内引号/脚本块感知扫描：是否存在给定危险标记（顶层出现即危险）。 */
function containsTopLevel(text: string, markers: readonly string[]): boolean {
  return findTopLevelSeparator(text, markers) !== -1;
}

/** 危险正则（作用于整段，不区分引号内外——引号内出现这些模式同样保守判危险）。 */
const DANGEROUS_TEXT_PATTERNS: readonly RegExp[] = [
  /\$\(/, // 子表达式
  /`/, // 反引号（转义 / 子表达式入口）
  /@\(/, // 数组子表达式
  /[><]{1,2}/, // 重定向 > >> < 2> *>
  /--%/, // stop-parsing
  /-encodedcommand/i,
  /\[\s*(system|management|diagnostics|collections|text|regex|io|net|security)\./i, // .NET 类型字面量
  /new-object/i,
  /add-type/i,
  /[&|]\s*$/, // 行尾悬挂管道/调用
];

/** 脚本块 `{` 单独判定：仅 tolerated cmdlet 允许携带，其余出现即危险。 */
const SCRIPT_BLOCK_PATTERN = /\{/;

/** 命令首 token 是否为路径样式（直接执行脚本 / 可执行文件）。 */
function startsWithPathToken(firstToken: string): boolean {
  if (/^["']/.test(firstToken)) {
    return true; // 带引号的可执行路径
  }
  return /^(\.\\|\.\/|~\/|~\\|[a-z]:[\\/]|\/)/i.test(firstToken);
}

function normalizeForMatch(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 提取语句段的命令前缀（用于黑/白名单匹配与建议前缀）。 */
function extractSegmentPrefix(segment: string): string {
  const normalized = normalizeForMatch(segment);
  const tokens = normalized.split(' ');
  // 多 token 内置条目（如 `git status`、`route print`）在清单中按最长前缀匹配，
  // 这里返回「首 token + 可选第二 token」两个候选由调用方组合匹配。
  return tokens[0] ?? '';
}

/**
 * 段是否命中内置只读清单：
 * 先试「首 token + 第二 token」组合（覆盖 git/npm 子命令与多 token 条目），再退回首 token。
 */
function matchesBuiltinList(segmentLower: string): boolean {
  const normalized = normalizeForMatch(segmentLower);
  const spaceIdx = normalized.indexOf(' ');
  if (spaceIdx !== -1) {
    const twoTokens = normalized.slice(0, normalized.indexOf(' ', spaceIdx + 1) === -1 ? normalized.length : normalized.indexOf(' ', spaceIdx + 1));
    if (BUILTIN_READONLY_COMMANDS.includes(twoTokens)) {
      return true;
    }
    // 多 token 条目允许命令串以清单条目为前缀（如 `git status -s`）
    for (const entry of BUILTIN_READONLY_COMMANDS) {
      if (entry.includes(' ') && (normalized === entry || normalized.startsWith(`${entry} `))) {
        return true;
      }
    }
  }
  const first = extractSegmentPrefix(normalized);
  if (BUILTIN_READONLY_COMMANDS.includes(first)) {
    // 脚本块类 cmdlet 放行，块内容由危险模式检测兜底
    return true;
  }
  return false;
}

/**
 * 剥离标量赋值段的 `$name =` 前缀，返回右值文本；非普通标量赋值返回 null。
 * 仅接受无作用域限定的普通变量名（`$a`、`$files`）；`$env:` / `$global:` 等带作用域的赋值
 * 可能写进程环境或全局态，保守不识别为赋值段（回落后续判定 / 弹窗）。
 * 复合赋值（`+=`、`-=` 等）前缀不匹配，同样回落。
 */
function extractScalarAssignmentRValue(part: string): string | null {
  const match = /^\$[a-z_][a-z0-9_]*\s*=\s*([\s\S]*)$/i.exec(part.trim());
  return match ? match[1].trim() : null;
}

/**
 * 右值是否为「无副作用字面量」：单 / 双引号字符串、数值、布尔 / null、单个变量引用。
 * 双引号串允许 `$var` 变量插值，但禁止 `$(` 子表达式与反引号（命令替换入口）。
 * 命中则该赋值段无副作用、可直接放行；未命中的右值会被当作命令继续走危险扫描 + 清单匹配。
 */
function isLiteralRValue(rvalue: string): boolean {
  if (/^'(?:[^']|'')*'$/.test(rvalue)) {
    return true; // 单引号字符串（'' 为字面单引号）
  }
  if (/^"(?:[^"`]|`[\s\S])*"$/.test(rvalue) && !rvalue.includes('$(')) {
    return true; // 双引号字符串：允许变量插值，禁子表达式
  }
  if (/^-?\d+(?:\.\d+)?$/.test(rvalue)) {
    return true; // 数值
  }
  if (/^\$(?:true|false|null)$/i.test(rvalue)) {
    return true; // 布尔 / null
  }
  if (/^\$[a-z_][a-z0-9_]*$/i.test(rvalue)) {
    return true; // 单个变量引用（$a = $b）
  }
  return false;
}

/**
 * 赋值段右值能否自动执行：
 *   1. 字面量右值（无副作用）             → 放行
 *   2. 右值为命令 → 与裸命令同一判定链：危险扫描 → 内置只读清单 → 用户白名单
 *   3. 嵌套赋值（`$a = $b = ls`）         → 递归判定（逐层剥离前缀自然收敛）
 * 右值中的顶层 `|` 已在 splitPipeline 阶段拆走，故此处右值不含顶层管道。
 */
function isAutoRunnableRValue(rvalue: string, config: CommandListConfig): boolean {
  if (isLiteralRValue(rvalue)) {
    return true;
  }
  if (scanSegmentDanger(rvalue)) {
    return false;
  }
  const lower = rvalue.toLowerCase();
  if (matchesBuiltinList(lower) || matchesUserList(lower, config.commandAllowlist)) {
    return true;
  }
  const nested = extractScalarAssignmentRValue(rvalue);
  if (nested !== null) {
    return isAutoRunnableRValue(nested, config);
  }
  return false;
}

/** 段是否命中用户清单（前缀匹配：条目 `git` 放行 `git status`，条目 `git status` 只放行 `git status ...`）。 */
function matchesUserList(segmentLower: string, list: string[] | undefined): boolean {
  if (!list || list.length === 0) {
    return false;
  }
  const normalized = normalizeForMatch(segmentLower);
  return list.some((entry) => {
    const e = normalizeForMatch(entry);
    return normalized === e || normalized.startsWith(`${e} `);
  });
}

/** 对单个语句段（或管道子段）做危险模式扫描。返回原因或空串。 */
function scanSegmentDanger(segment: string): string {
  // 1) 顶层分隔类危险：调用/后台操作符（管道由 evaluateCommandAutoRun 拆段后逐段判定）
  if (containsTopLevel(segment, ['&'])) {
    return '包含调用/后台操作符（&）';
  }
  // 2) 文本级危险模式（含引号内，保守处理）；脚本块 `{` 单独条件判定
  for (const pattern of DANGEROUS_TEXT_PATTERNS) {
    if (pattern.test(segment)) {
      return `包含可疑语法（${pattern.source}），不接受自动执行`;
    }
  }
  if (SCRIPT_BLOCK_PATTERN.test(segment)) {
    // 仅 tolerated cmdlet（foreach/where/select 等）允许携带脚本块，块内容由 checkScriptBlockContent 判定；
    // 管道场景下脚本块总是出现在管道右段（foreach/where 等），左段 cmdlet 需按前一段管道子段的首 token 检查
    const tolerated = isScriptBlockToleratedSegment(segment);
    if (!tolerated) {
      return '包含脚本块（{...}），不接受自动执行';
    }
    const blockIssue = checkScriptBlockContent(segment);
    if (blockIssue) {
      return blockIssue;
    }
  }
  // 3) 高危 cmdlet / 操作符：按首 token 匹配
  const normalized = normalizeForMatch(segment);
  const tokens = normalized.split(' ');
  const first = tokens[0] ?? '';
  if (DANGEROUS_COMMANDS.includes(first)) {
    return `高危命令 ${first} 不在自动执行范围`;
  }
  // dot-sourcing / 点调用
  if (first === '.' || first === '&') {
    return '包含 dot-sourcing / 调用操作符';
  }
  if (startsWithPathToken(tokens[0] ?? '')) {
    return '以路径直接执行程序/脚本不接受自动执行';
  }
  return '';
}

/**
 * 判断段中脚本块是否被 tolerated cmdlet 携带：
 * 脚本块总是出现在携带它的 cmdlet 之后的参数位置，因此检查每个顶层管道子段的首 token，
 * 任一子段首 token 是 tolerated cmdlet 且段中确实存在 `{`，即视为合法承载。
 */
function isScriptBlockToleratedSegment(segment: string): boolean {
  return splitPipeline(segment).some((part) => {
    const firstToken = normalizeForMatch(part).split(' ')[0] ?? '';
    return SCRIPT_BLOCK_TOLERATED_COMMANDS.has(firstToken);
  });
}

/**
 * tolerated cmdlet 的脚本块内容判定：对每个 {...} 内部文本做文本级危险检查
 * 与逐 token 高危命令检查。嵌套 `{` 判危险（保守）。
 */
function checkScriptBlockContent(segment: string): string {
  let i = 0;
  while (i < segment.length) {
    if (segment[i] !== '{') {
      i += 1;
      continue;
    }
    // 找配对 '}'（引号感知；嵌套 '{' 直接判危险）
    let depth = 1;
    let j = i + 1;
    let inner = '';
    while (j < segment.length && depth > 0) {
      const ch = segment[j];
      if (ch === '{') {
        return '包含嵌套脚本块，不接受自动执行';
      }
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      } else if (ch === "'") {
        // 跳过单引号字符串（'' 转义）
        inner += ch;
        j += 1;
        while (j < segment.length) {
          inner += segment[j];
          if (segment[j] === "'") {
            if (segment[j + 1] === "'") {
              inner += segment[j + 1];
              j += 2;
              continue;
            }
            break;
          }
          j += 1;
        }
      } else if (ch === '"') {
        // 跳过双引号字符串（` 转义）
        inner += ch;
        j += 1;
        while (j < segment.length) {
          inner += segment[j];
          if (segment[j] === '`') {
            inner += segment[j + 1] ?? '';
            j += 2;
            continue;
          }
          if (segment[j] === '"') {
            break;
          }
          j += 1;
        }
      } else {
        inner += ch;
      }
      j += 1;
    }
    if (depth > 0) {
      return '脚本块未闭合，不接受自动执行';
    }
    // 块内文本级危险检查（重定向/子表达式等；`{` 已由嵌套检查处理）
    for (const pattern of DANGEROUS_TEXT_PATTERNS) {
      if (pattern.test(inner)) {
        return `脚本块内包含可疑语法（${pattern.source}），不接受自动执行`;
      }
    }
    // 块内含管道 → 拆子段逐段判定（如 { iex $_ }）
    const innerParts = splitPipeline(inner);
    for (const part of innerParts) {
      const innerTokens = normalizeForMatch(part).split(' ').filter(Boolean);
      for (const token of innerTokens) {
        if (DANGEROUS_COMMANDS.includes(token)) {
          return `脚本块内包含高危命令 ${token}`;
        }
        if (startsWithPathToken(token) && innerTokens.indexOf(token) === 0) {
          return '脚本块内以路径直接执行程序/脚本';
        }
      }
    }
    i = j + 1;
  }
  return '';
}

/**
 * 判定一条命令能否跳过确认自动执行。
 * 仅用于交互式会话链路；unattended / workflow 链路由调用方先行拦截。
 */
export function evaluateCommandAutoRun(command: string, config: CommandListConfig): CommandAutoRunResult {
  const segments = splitStatements(command);
  if (segments.length === 0) {
    return { decision: 'confirm', reason: '空命令' };
  }

  for (const segment of segments) {
    const segmentLower = segment.toLowerCase();

    // 1) 黑名单优先（整段前缀匹配）
    if (matchesUserList(segmentLower, config.commandDenylist)) {
      return { decision: 'confirm', reason: '命中用户黑名单' };
    }
    // 2) 危险模式（父段级：文本级模式、脚本块、首 token）
    const danger = scanSegmentDanger(segment);
    if (danger) {
      return { decision: 'confirm', reason: danger };
    }
    // 3) 按顶层 `|` 拆管道子段，逐段走完整判定链（右段高危首 token 只有在子段层面才能查到）
    const pipelineParts = splitPipeline(segment);
    for (const part of pipelineParts) {
      const partDanger = scanSegmentDanger(part);
      if (partDanger) {
        return { decision: 'confirm', reason: partDanger };
      }
      const partLower = part.toLowerCase();
      if (matchesBuiltinList(partLower)) {
        continue;
      }
      if (matchesUserList(partLower, config.commandAllowlist)) {
        continue;
      }
      // 标量赋值段放行（`$x=...`）：右值为字面量时无副作用直接放行；
      // 右值为命令时，按同一条判定链（危险扫描 + 清单匹配）递归校验右值，
      // 使 `$files=Get-ChildItem ...` 与裸 `Get-ChildItem ...` 享有一致的安全判定。
      const rvalue = extractScalarAssignmentRValue(part);
      if (rvalue !== null && isAutoRunnableRValue(rvalue, config)) {
        continue;
      }
      return { decision: 'confirm', reason: '命令不在自动执行清单内' };
    }
  }

  return { decision: 'auto', reason: '命中命令白名单' };
}

/**
 * 为确认卡「总是允许此命令」提取建议加入白名单的前缀。
 * 未命中黑名单 / 危险模式时返回前两 token（如 `git status`）或首 token；否则返回空串（弹窗不显示勾选）。
 */
export function extractCommandPrefix(command: string, config: CommandListConfig): string {
  const segments = splitStatements(command);
  if (segments.length === 0) {
    return '';
  }
  for (const segment of segments) {
    if (matchesUserList(segment.toLowerCase(), config.commandDenylist)) {
      return '';
    }
    if (scanSegmentDanger(segment)) {
      return '';
    }
  }
  // 取前两 token：覆盖 `git status`、`npm run` 这类子命令粒度
  return segments[0].trim().toLowerCase().split(/\s+/).slice(0, 2).join(' ');
}

/** 供确认卡 detail 展示的规范化命令摘要。 */
export function summarizeCommand(command: string): string {
  const flat = command.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

