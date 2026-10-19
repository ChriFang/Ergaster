export type SlashSkillOption = {
  name: string;
  description: string;
  /** 归类用途：'command' 落到「命令」分组，缺省/'skill' 落到「Skills」分组。 */
  kind?: 'command' | 'skill';
};

export type SlashTriggerState = {
  /** "/" 在文本中的下标。 */
  startIndex: number;
  /** "/" 之后已输入的过滤词，不含空白。 */
  query: string;
};

function isBoundaryChar(char: string | undefined) {
  return char === undefined || /\s/.test(char);
}

/**
 * 判断光标处是否处于 "/" 指令触发态。
 *
 * 只有 "/" 位于行首或空白字符之后才算触发，否则粘贴 URL（https://…）
 * 和文件路径（src/main/…）会不停误弹菜单。
 */
export function getSlashTriggerState(text: string, caret: number): SlashTriggerState | null {
  if (caret < 1 || caret > text.length) {
    return null;
  }

  for (let index = caret - 1; index >= 0; index -= 1) {
    const char = text[index];

    if (char === undefined || /\s/.test(char)) {
      // 触发词里不允许空白，遇到空白说明光标已经不在候选词内
      return null;
    }

    if (char === '/') {
      if (!isBoundaryChar(text[index - 1])) {
        return null;
      }

      return { startIndex: index, query: text.slice(index + 1, caret) };
    }
  }

  return null;
}

/**
 * 按查询词过滤候选。
 *
 * 排序规则固定：名称前缀命中 > 名称包含 > 仅描述包含，同档内保持原顺序，
 * 这样菜单里的项不会因为输入过程而跳动。
 */
export function filterSlashCandidates(candidates: SlashSkillOption[], query: string): SlashSkillOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...candidates];
  }

  const prefixMatches: SlashSkillOption[] = [];
  const nameMatches: SlashSkillOption[] = [];
  const descriptionMatches: SlashSkillOption[] = [];

  for (const candidate of candidates) {
    const name = candidate.name.toLowerCase();

    if (name.startsWith(normalized)) {
      prefixMatches.push(candidate);
      continue;
    }

    if (name.includes(normalized)) {
      nameMatches.push(candidate);
      continue;
    }

    if (candidate.description.toLowerCase().includes(normalized)) {
      descriptionMatches.push(candidate);
    }
  }

  return [...prefixMatches, ...nameMatches, ...descriptionMatches];
}

/** 把选中的 skill 写回输入框：用 "/name " 替换掉 "/query"，并返回新的光标位置。 */
export function applySlashSelection(text: string, trigger: SlashTriggerState, name: string) {
  const before = text.slice(0, trigger.startIndex);
  const after = text.slice(trigger.startIndex + 1 + trigger.query.length);
  // 后面已经紧跟空白时不再补空格，避免出现双空格
  const token = `/${name}${isBoundaryChar(after[0]) && after.length > 0 ? '' : ' '}`;

  return {
    text: `${before}${token}${after}`,
    caret: before.length + token.length,
  };
}

/**
 * 从待发送文本里解析出被引用的 skill 名，按出现顺序去重。
 *
 * 标记本身保留在用户可见的 prompt 里，这样会话历史能看出这条消息用了哪个 skill；
 * 只有注入给模型的那份会额外拼上 SKILL.md 正文。
 */
export function extractSlashSkillNames(text: string, knownNames: string[]): string[] {
  if (knownNames.length === 0) {
    return [];
  }

  const knownSet = new Set(knownNames);
  const found: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(/\/([^\s/]+)/g)) {
    const index = match.index ?? 0;
    if (!isBoundaryChar(text[index - 1])) {
      continue;
    }

    const name = match[1];
    if (!name || seen.has(name) || !knownSet.has(name)) {
      continue;
    }

    seen.add(name);
    found.push(name);
  }

  return found;
}

export type SkillInjectionInput = {
  name: string;
  directoryPath: string;
  content: string;
};

/**
 * 构造注入给模型的 skill 段落。
 *
 * 必须带上根目录说明：SKILL.md 里的相对路径（如 scripts/xxx.py）是相对于 skill 目录的，
 * 现有工具路径 executeUserSkillCall 也是这么做的，漏掉会让所有相对路径指错。
 */
export function buildSkillInjection(skills: SkillInjectionInput[]): string {
  if (skills.length === 0) {
    return '';
  }

  const sections = skills.map((skill) => [
    `## Skill: ${skill.name}`,
    `[Skill 根目录]: ${skill.directoryPath}`,
    '本 Skill 内的相对路径（如 scripts/xxx.py）均相对于上述根目录，而非当前工作区目录。'
    + '执行脚本或读取文件时请使用该根目录拼接的绝对路径。',
    '',
    skill.content.trim(),
  ].join('\n'));

  return [
    '【用户通过 / 指令显式指定了以下 Skill，请按其中的步骤执行，不要再询问是否使用】',
    ...sections,
  ].join('\n\n');
}

/** 内置 "/" 指令名（/json-ui）：显式要求本轮用 ui_form 表单收集参数（区别于用户 Skill，无 SKILL.md）。 */
export const UI_DSL_SLASH_COMMAND = 'json-ui';

/** /json-ui 注入给模型的指令段落：要求本轮用 ui_form 工具，而不是逐项文字追问。 */
export function buildUiDslInjection(): string {
  return [
    '【用户显式要求本轮用表单收集参数】',
    '请调用 ui_form 工具把需要用户提供的参数做成表单，不要用文字逐项追问。字段不超过 8 个。',
  ].join('\n');
}

/** 内置 "/" 指令名：显式要求本轮用 render_ui 渲染交互式 HTML。 */
export const UI_HTML_SLASH_COMMAND = 'html';

/** /html 注入给模型的指令段落：要求本轮用 render_ui 工具渲染交互式 HTML。 */
export function buildUiHtmlInjection(): string {
  return [
    '【用户显式要求本轮用交互式 HTML 呈现】',
    '请调用 render_ui 工具生成一个交互式 HTML 界面（图表 / canvas / 自定义控件等），'
    + '在其中收集用户操作，完成后调用 window.agentSubmit(data) 回传，不要用文字长篇描述界面。',
  ].join('\n');
}

export type SlashGroupKey = 'recent' | 'command' | 'skill';

export type SlashGroup = {
  key: SlashGroupKey;
  title: string;
  items: SlashSkillOption[];
};

const SLASH_GROUP_TITLES: Record<SlashGroupKey, string> = {
  recent: '最近使用',
  command: '命令',
  skill: 'Skills',
};

/**
 * 把候选按「最近使用 / 命令 / Skills」分组，供 "/" 菜单分区展示。
 * - recentNames 命中的项提升到「最近使用」，按 recentNames 顺序排列；
 * - 命令 / Skills 分区展示全部候选（按 kind 归类），最近使用命中的项仍保留在原分区，
 *   即同一项可同时出现在「最近使用」和它所属的分区；
 * - 只返回非空分组，顺序固定为 recent → command → skill。
 */
export function groupSlashCandidates(
  candidates: readonly SlashSkillOption[],
  recentNames: readonly string[],
): SlashGroup[] {
  const byName = new Map<string, SlashSkillOption>();
  for (const candidate of candidates) {
    if (!byName.has(candidate.name)) {
      byName.set(candidate.name, candidate);
    }
  }

  const recentItems: SlashSkillOption[] = [];
  const seenRecent = new Set<string>();
  for (const name of recentNames) {
    const candidate = byName.get(name);
    if (candidate && !seenRecent.has(name)) {
      recentItems.push(candidate);
      seenRecent.add(name);
    }
  }

  // 命令/Skills 分区展示全部候选（按 name 自身去重），最近使用只是把常用项额外提到顶部，
  // 不从原分区移除。
  const commandItems: SlashSkillOption[] = [];
  const skillItems: SlashSkillOption[] = [];
  const seenName = new Set<string>();
  for (const candidate of candidates) {
    if (seenName.has(candidate.name)) {
      continue;
    }
    seenName.add(candidate.name);
    if (candidate.kind === 'command') {
      commandItems.push(candidate);
    } else {
      skillItems.push(candidate);
    }
  }

  const groups: SlashGroup[] = [];
  if (recentItems.length > 0) {
    groups.push({ key: 'recent', title: SLASH_GROUP_TITLES.recent, items: recentItems });
  }
  if (commandItems.length > 0) {
    groups.push({ key: 'command', title: SLASH_GROUP_TITLES.command, items: commandItems });
  }
  if (skillItems.length > 0) {
    groups.push({ key: 'skill', title: SLASH_GROUP_TITLES.skill, items: skillItems });
  }
  return groups;
}
