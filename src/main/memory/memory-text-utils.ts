import type { MemoryEntry, MemoryKind } from '../../shared/memory';

const MEMORY_KINDS: MemoryKind[] = ['profile', 'preference', 'project', 'fact'];

/** 抽取节流的三档判定结果：跳过 / 计入定期扫描 / 立即抽取。 */
export type ExtractDecision = 'skip' | 'sweep' | 'now';

/** 内容上限：一条记忆保持简短，超出即截断。 */
export const MEMORY_CONTENT_MAX_LENGTH = 300;

/** 归一化用于相似度/去重比较：去空白、小写化拉丁字母。 */
function normalize(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/** 字符二元组集合，兼顾中英文的轻量相似度（无需向量）。 */
function bigrams(text: string): Set<string> {
  const s = normalize(text);
  const grams = new Set<string>();
  for (let i = 0; i < s.length - 1; i += 1) {
    grams.add(s.slice(i, i + 2));
  }
  if (s.length === 1) {
    grams.add(s);
  }
  return grams;
}

/** 字符二元组 Jaccard 相似度 ∈ [0,1]。 */
export function similarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const g of ga) {
    if (gb.has(g)) {
      inter += 1;
    }
  }
  return inter / (ga.size + gb.size - inter);
}

/** 是否与已有条目近重复（写入去重阈值）。 */
export function isNearDuplicate(content: string, existing: MemoryEntry[], threshold = 0.82): boolean {
  return existing.some((entry) => similarity(content, entry.content) >= threshold);
}

/** 检索排序：pinned 优先 → 与 query 相似度 → 被使用次数（受限加权）→ 近期使用/更新。 */
export function rankEntriesForPrompt(entries: MemoryEntry[], query: string, limit: number): MemoryEntry[] {
  return entries
    .map((entry) => ({
      entry,
      // useCount 加权上限 20，远小于相似度的 0..100，只做温和加成/破平，让被反复命中的记忆更稳地留在 top-N。
      score: (entry.pinned ? 1000 : 0) + (query ? similarity(query, entry.content) * 100 : 0) + Math.min(entry.useCount, 20),
      recency: Date.parse(entry.lastUsedAt ?? entry.updatedAt) || 0,
    }))
    .sort((a, b) => (b.score - a.score) || (b.recency - a.recency))
    .slice(0, Math.max(0, limit))
    .map((scored) => scored.entry);
}

/** 拼成注入 system 提示的记忆块，受字符预算约束；无可注入内容时返回空串。 */
export function buildMemoryBlock(entries: MemoryEntry[], budgetChars = 1500): string {
  const lines: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const line = `- (${entry.kind}) ${entry.content}`;
    if (used + line.length > budgetChars) {
      break;
    }
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) {
    return '';
  }
  return [
    '【关于用户的长期记忆】以下是过往会话中积累的、关于该用户的持久事实与偏好。',
    '请在本轮对话中自然地加以利用；若与用户当前的说法冲突，以当前为准，并可调用 memory_forget 纠正。',
    ...lines,
  ].join('\n');
}

export const MEMORY_EXTRACTION_SYSTEM_PROMPT = `你是长期记忆抽取器。目标：只记录**跨会话、长期有用**的、关于用户本人的稳定信息，供未来与当前任务*完全无关*的对话中更好地服务该用户。

只在同时满足以下条件时提取：
- 是关于用户本人的持久属性：身份/职业/角色、长期使用的技术栈与工具、稳定的工作方式与沟通偏好、长期目标或硬性约束；
- 数周后、在一个话题完全不同的新对话里仍然成立且有用；
- 不是能从代码、文档或应用配置里直接读到的内容。

必须排除（宁可返回空数组，也不要记）：
- 当前任务/会话的进展或状态（“正在做/正在选/正在修复……”）；
- 一次性的产物或细节：具体文件名、脚本名、目录或路径、某个 bug、某次改动、某个方案选项；
- 只在某个具体项目内有意义、脱离该项目就无用的信息。

判断基准（务必自检）：如果这条信息下周在另一个毫不相关的话题里帮不上忙，就不要记。最多提取 3 条，只保留最有价值的。

示例：
- 记：{"kind":"profile","content":"用户是后端工程师，主要用 Go 与 TypeScript"}
- 记：{"kind":"preference","content":"用户偏好简短、直接的回复"}
- 不记（任务进展/一次性产物）：“用户正在为 PC 应用选择图标方案”“项目里有个 fixbump.py 脚本”“产出目录是 ~/Documents/…”

输出严格的 JSON 数组，每项 {"kind":"profile|preference|fact","content":"一句话事实"}；没有符合的就输出 []。不要输出除 JSON 外的任何文字。`;

/** 从抽取模型输出里解析记忆条目，容错到能用为止。 */
export function parseExtractedMemories(raw: string): Array<{ kind: MemoryKind; content: string }> {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const out: Array<{ kind: MemoryKind; content: string }> = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const rawContent = (item as { content?: unknown }).content;
    const content = typeof rawContent === 'string' ? rawContent.trim() : '';
    if (!content) {
      continue;
    }
    const rawKind = (item as { kind?: unknown }).kind;
    const kind: MemoryKind = MEMORY_KINDS.includes(rawKind as MemoryKind) ? (rawKind as MemoryKind) : 'fact';
    out.push({ kind, content: content.slice(0, MEMORY_CONTENT_MAX_LENGTH) });
  }
  return out;
}

// 明显无需记忆的轻量轮次：寒暄、确认、纯操作指令。
const ACK_OR_COMMAND = /^(谢谢|多谢|好的?|嗯+|行|可以|对|是的|没问题|收到|停|取消|继续|重试|再来一次|ok(ay)?|thx|thanks?|yes|no|next)[\s！!。.~]*$/i;
// 高价值信号：第一人称自述 / 偏好规则 / 显式记忆意图 → 立即抽取。
const SELF_DISCLOSURE = /(^|[^\p{L}])(我|我们|咱|俺)(是|叫|在|用|喜欢|讨厌|习惯|负责|做|想|需要|偏好|团队|公司|项目)/u;
const PREFERENCE_RULE = /(以后|默认|总是|从现在起|每次|不要再?|别再?|请始终|请不要|记住|记一下|remember|always|never|prefer)/i;

/**
 * 三档判定（纯函数、无 LLM）：门只负责廉价地砍掉明显无事实的轮次以省调用，
 * 真正判断“有没有事实”的是随后会返回 [] 的抽取调用。
 * - skip：过短或寒暄/纯指令；
 * - now：命中自述/偏好/记忆意图，立即抽取；
 * - sweep：其余，交给“每 N 个实质轮次扫一次”的防抖。
 */
export function classifyTurn(userText: string): ExtractDecision {
  const text = userText.trim();
  if (text.length < 4 || ACK_OR_COMMAND.test(text)) {
    return 'skip';
  }
  if (SELF_DISCLOSURE.test(text) || PREFERENCE_RULE.test(text)) {
    return 'now';
  }
  return 'sweep';
}
