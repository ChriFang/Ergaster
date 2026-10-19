import path from 'node:path';

/** 单次读取的默认行数。行数太大会直接把模型上下文吃满。 */
export const defaultReadLines = 200;
/** 单次读取的行数上限。 */
export const maxReadLines = 500;
/** 超过该体积的文件不参与读取与内容检索。 */
export const maxCodeFileBytes = 10 * 1024 * 1024;
/**
 * 通用（日志等）场景下文本文件的读取/检索体积上限。
 * 日志文件常达数十 MB，沿用代码场景的 10MB 会把目标文件静默跳过，故单列更大的上限。
 */
export const maxTextScanFileBytes = 100 * 1024 * 1024;
/** 内容检索的结果条数上限。 */
export const maxGrepResults = 100;
/** 文件名检索的结果条数上限。 */
export const maxGlobResults = 200;
/** 目录遍历的节点数上限，防止超大工程把主进程拖死。 */
export const maxWalkEntries = 50_000;

/** 与 CodeWhale 一致的默认排除目录：构建产物与依赖目录对代码理解没有价值。 */
export const defaultIgnoredDirectories = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.nuxt',
  '.output',
  'coverage',
  '.idea',
  '.vscode-test',
  '.gradle',
  '.cache',
  'release',
];

/**
 * 文件沙箱抽象：把遍历/检索/读取引擎与「可访问边界」解耦。
 * - Code 模式用 ProjectScope（工程根 + .gitignore）
 * - 通用模式用 AllowedPathsScope（全局 allowedPaths + 默认排除目录）
 * 引擎只认 FileScope，不认具体根目录，从而两种模式共用同一套实现。
 */
export interface FileScope {
  /** 校验输入路径并返回绝对路径；越界/非法时抛错。 */
  resolve(input: string): Promise<string>;
  /** 把绝对路径转成输出 / glob 匹配用的展示路径（统一 "/" 分隔）。 */
  relativize(absolutePath: string): string;
  /** 遍历时的忽略判定函数（相对路径 + 是否目录 → 是否跳过）。 */
  getIgnoreMatcher(): Promise<(relativePath: string, isDirectory: boolean) => boolean>;
}

export type IgnoreRule = {
  /** 规范化后的模式（已去掉前后空白、前导 "/" 与末尾 "/"）。 */
  pattern: string;
  /** 以 "!" 开头的取反规则。 */
  negated: boolean;
  /** 以 "/" 结尾，只匹配目录。 */
  directoryOnly: boolean;
  /** 模式中间含 "/"，只相对工程根匹配；否则匹配任意层级的名字。 */
  anchored: boolean;
};

/**
 * 把 glob 模式编译成正则。支持 `**`（跨目录）、`*`（不跨目录）、`?`（单字符）。
 * 其余字符一律转义，避免用户模式被当成正则执行。
 */
export function globToRegExp(pattern: string): RegExp {
  let source = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (char === '*') {
      const isDoubleStar = pattern[index + 1] === '*';
      if (isDoubleStar) {
        const isFollowedBySlash = pattern[index + 2] === '/';
        // "**/" 需要能匹配零层目录，因此把斜杠一起吃掉
        source += isFollowedBySlash ? '(?:.*/)?' : '.*';
        index += isFollowedBySlash ? 2 : 1;
        continue;
      }
      source += '[^/]*';
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`^${source}$`);
}

export function matchGlob(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}

/** 解析 .gitignore 文本。只支持常见子集：注释、取反、目录限定、锚定路径与 glob。 */
export function parseIgnorePatterns(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const negated = line.startsWith('!');
    let pattern = negated ? line.slice(1).trim() : line;
    if (!pattern) {
      continue;
    }

    const directoryOnly = pattern.endsWith('/');
    if (directoryOnly) {
      pattern = pattern.slice(0, -1);
    }

    const anchored = pattern.startsWith('/') || pattern.slice(0, -1).includes('/');
    if (pattern.startsWith('/')) {
      pattern = pattern.slice(1);
    }

    if (!pattern) {
      continue;
    }

    rules.push({ pattern, negated, directoryOnly, anchored });
  }

  return rules;
}

/**
 * 生成忽略判定函数。relativePath 使用 "/" 分隔且不带前导斜杠。
 * 后匹配的规则覆盖先匹配的规则，与 gitignore 语义一致。
 */
export function createIgnoreMatcher(rules: IgnoreRule[]) {
  const compiled = rules.map((rule) => ({ rule, regExp: globToRegExp(rule.pattern) }));

  return function isIgnored(relativePath: string, isDirectory: boolean): boolean {
    const normalized = relativePath.replace(/^\/+/, '');
    if (!normalized) {
      return false;
    }

    const baseName = normalized.split('/').pop() ?? normalized;
    let ignored = false;

    for (const { rule, regExp } of compiled) {
      if (rule.directoryOnly && !isDirectory) {
        continue;
      }

      const target = rule.anchored ? normalized : baseName;
      const matched = regExp.test(target)
        // 目录被忽略时，其子路径同样被忽略
        || (rule.anchored && normalized.startsWith(`${rule.pattern}/`));

      if (matched) {
        ignored = !rule.negated;
      }
    }

    return ignored;
  };
}

/**
 * 把工具参数里的路径解析为绝对路径，并确保结果仍在工程根内。
 * 相对路径按工程根解析；绝对路径必须本身就落在工程根内，否则视为越界。
 * 越界（../、指向工程外的绝对路径、不同盘符）时抛错，由工具层转成模型可读的错误。
 */
export function resolveProjectPath(projectRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(projectRoot);
  const trimmed = relativePath.trim();
  const candidate = trimmed === '' || trimmed === '.' || trimmed === './'
    ? normalizedRoot
    : path.resolve(normalizedRoot, trimmed);

  if (!isWithinRoot(normalizedRoot, candidate)) {
    throw new Error('目标路径超出了当前代码工程的根目录范围。');
  }

  return candidate;
}

export function isWithinRoot(projectRoot: string, targetPath: string): boolean {
  const normalizedRoot = path.resolve(projectRoot);
  const normalizedTarget = path.resolve(targetPath);

  if (normalizedTarget === normalizedRoot) {
    return true;
  }

  return normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

/** 统一输出 "/" 分隔的工程内相对路径，避免 Windows 反斜杠混进模型上下文。 */
export function toProjectRelativePath(projectRoot: string, targetPath: string): string {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(targetPath));
  return relative.split(path.sep).join('/');
}

/** 带行号输出，方便模型引用具体行并继续分页读取。 */
export function formatNumberedLines(lines: string[], startLine: number): string {
  const width = String(startLine + lines.length - 1).length;
  return lines.map((line, index) => `${String(startLine + index).padStart(width, ' ')}\t${line}`).join('\n');
}

/** 出现 NUL 字节即视为二进制文件，与 ripgrep 的判定一致。 */
export function looksBinary(buffer: Buffer | Uint8Array): boolean {
  const limit = Math.min(buffer.length, 8000);
  for (let index = 0; index < limit; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

/** 校验用户给出的正则，避免非法模式直接抛到工具执行层之外。 */
export function compileSearchPattern(pattern: string, caseInsensitive: boolean): RegExp {
  try {
    return new RegExp(pattern, caseInsensitive ? 'i' : '');
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`正则表达式不合法：${message}`);
  }
}

/** 单次写入的内容上限。代码文件不该有这么大，超过基本是模型出错。 */
export const maxWriteBytes = 2 * 1024 * 1024;

/** 禁止写入的目录：仓库元数据与依赖目录，改坏了会破坏整个工程。 */
export const writeDeniedDirectories = ['.git', '.hg', '.svn', 'node_modules'];

/** 禁止写入的文件：锁文件由包管理器生成，凭证文件不该由模型改。 */
export const writeDeniedFileNames = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'cargo.lock',
  'go.sum',
  'poetry.lock',
  'composer.lock',
  'gemfile.lock',
  '.env',
  '.env.local',
  '.npmrc',
  'id_rsa',
];

/** 新建文件时允许的扩展名白名单（小写，含点）。 */
export const writeAllowedExtensions = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc',
  '.css', '.scss', '.less', '.html', '.htm', '.vue', '.svelte',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.swift',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.m', '.mm',
  '.php', '.pl', '.lua', '.sh', '.bash', '.zsh', '.ps1',
  '.sql', '.proto', '.graphql', '.gql',
  '.md', '.mdx', '.txt', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.xml', '.svg', '.gradle', '.tf',
];

/** 允许新建的无扩展名文件（小写文件名）。 */
export const writeAllowedFileNames = [
  'dockerfile',
  'makefile',
  'readme',
  'license',
  'changelog',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.dockerignore',
  '.prettierrc',
  '.eslintrc',
];

/**
 * 写入前的路径黑名单检查。返回拒绝原因，通过时返回 null。
 * 只看工程内相对路径，因此必须在 resolveProjectPath 之后调用。
 */
export function getWriteDenialReason(relativePath: string): string | null {
  const normalized = relativePath.replace(/^\/+/, '');
  if (!normalized) {
    return '不能写入工程根目录本身。';
  }

  const segments = normalized.split('/');
  const deniedSegment = segments
    .slice(0, -1)
    .find((segment) => writeDeniedDirectories.includes(segment.toLowerCase()));
  if (deniedSegment) {
    return `禁止写入 ${deniedSegment}/ 目录下的文件。`;
  }

  const fileName = segments[segments.length - 1].toLowerCase();
  if (writeDeniedFileNames.includes(fileName)) {
    return `${fileName} 属于锁文件或凭证文件，禁止修改。`;
  }

  return null;
}

/** 新建文件时的扩展名白名单检查。已存在的文件不走这一步（能读就能改）。 */
export function getNewFileExtensionDenialReason(relativePath: string): string | null {
  const fileName = (relativePath.split('/').pop() ?? '').toLowerCase();
  if (!fileName) {
    return '文件名不能为空。';
  }

  if (writeAllowedFileNames.includes(fileName)) {
    return null;
  }

  const dotIndex = fileName.lastIndexOf('.');
  const extension = dotIndex > 0 ? fileName.slice(dotIndex) : '';
  if (extension && writeAllowedExtensions.includes(extension)) {
    return null;
  }

  return `不支持新建 "${fileName}" 这类文件，仅允许常见的源码与文本文件扩展名。`;
}

export type LineEnding = '\n' | '\r\n';

/** 以出现次数判定文件主要行尾。混用时以 CRLF 优先，避免把 Windows 文件改成混合行尾。 */
export function detectDominantLineEnding(text: string): LineEnding {
  const crlfCount = (text.match(/\r\n/g) ?? []).length;
  const lfOnlyCount = (text.match(/(?<!\r)\n/g) ?? []).length;
  return crlfCount > 0 && crlfCount >= lfOnlyCount ? '\r\n' : '\n';
}

export function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function applyLineEnding(text: string, ending: LineEnding): string {
  return ending === '\r\n' ? normalizeToLf(text).replace(/\n/g, '\r\n') : normalizeToLf(text);
}

/** 把易被聊天客户端替换掉的排版字符还原成 ASCII。逐字符替换，保证长度不变以便位置映射。 */
export function normalizePunctuation(text: string): string {
  return text.replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u00A0/g, ' ');
}

export type MatchKind = 'exact' | 'indentation' | 'punctuation';

export type UniqueMatch = {
  start: number;
  end: number;
  kind: MatchKind;
};

function findAllIndexes(haystack: string, needle: string): number[] {
  const indexes: number[] = [];
  let from = 0;

  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) {
      break;
    }
    indexes.push(index);
    from = index + 1;
  }

  return indexes;
}

function splitLinesWithOffsets(text: string) {
  const lines: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;

  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text[index] === '\n') {
      lines.push({ text: text.slice(start, index), start, end: index });
      start = index + 1;
    }
  }

  return lines;
}

/** 忽略每行前导空白后按行匹配，返回原文中对应的整行区间。 */
function findIndentationInsensitiveMatches(haystack: string, needle: string) {
  const haystackLines = splitLinesWithOffsets(haystack);
  const needleLines = normalizeToLf(needle).split('\n');
  // 末尾空行不参与匹配，否则 needle 带尾换行时永远差一行
  while (needleLines.length > 1 && needleLines[needleLines.length - 1].trim() === '') {
    needleLines.pop();
  }

  if (needleLines.length === 0) {
    return [];
  }

  const stripped = needleLines.map((line) => line.trimStart());
  const matches: Array<{ start: number; end: number }> = [];

  for (let index = 0; index + needleLines.length <= haystackLines.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < stripped.length; offset += 1) {
      if (haystackLines[index + offset].text.trimStart() !== stripped[offset]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      matches.push({
        start: haystackLines[index].start,
        end: haystackLines[index + needleLines.length - 1].end,
      });
    }
  }

  return matches;
}

/**
 * 在已归一化为 LF 的文本中定位唯一匹配。
 * 依次尝试精确匹配、缩进不敏感匹配、排版字符归一化匹配；每一级都要求唯一，
 * 命中多处时直接报错并要求补充上下文，绝不"取第一个"。
 */
export function findUniqueMatch(haystack: string, needle: string): UniqueMatch {
  if (needle === '') {
    throw new Error('search 不能为空。');
  }

  const exact = findAllIndexes(haystack, needle);
  if (exact.length === 1) {
    return { start: exact[0], end: exact[0] + needle.length, kind: 'exact' };
  }
  if (exact.length > 1) {
    throw new Error(`search 在文件中出现了 ${exact.length} 次，无法确定改哪一处。请重新读取文件并在 search 中包含更多上下文使其唯一。`);
  }

  const indentation = findIndentationInsensitiveMatches(haystack, needle);
  if (indentation.length === 1) {
    return { ...indentation[0], kind: 'indentation' };
  }
  if (indentation.length > 1) {
    throw new Error(`忽略缩进后 search 仍匹配到 ${indentation.length} 处，请在 search 中包含更多上下文使其唯一。`);
  }

  const normalizedHaystack = normalizePunctuation(haystack);
  const normalizedNeedle = normalizePunctuation(needle);
  const punctuation = findAllIndexes(normalizedHaystack, normalizedNeedle);
  if (punctuation.length === 1) {
    // 归一化是等长替换，因此下标可直接映射回原文
    return { start: punctuation[0], end: punctuation[0] + normalizedNeedle.length, kind: 'punctuation' };
  }
  if (punctuation.length > 1) {
    throw new Error(`归一化引号与破折号后 search 匹配到 ${punctuation.length} 处，请在 search 中包含更多上下文使其唯一。`);
  }

  throw new Error('在文件中找不到 search 指定的内容。请先用 code_read_file 读取该文件，照抄其中的原文（含缩进）作为 search。');
}

function countDelimiterDelta(text: string) {
  let curly = 0;
  let square = 0;
  let paren = 0;

  for (const char of text) {
    if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
  }

  return { curly, square, paren };
}

/**
 * 结构性破坏检测：search 的括号是配对的、replace 却不配对，说明替换会撕裂语法块；
 * 另一种典型事故是把一大段实现塌缩成一行空壳。命中则拒绝执行。
 */
export function detectStructuralLoss(search: string, replace: string): string | null {
  const searchDelta = countDelimiterDelta(search);
  const replaceDelta = countDelimiterDelta(replace);
  const searchBalanced = searchDelta.curly === 0 && searchDelta.square === 0 && searchDelta.paren === 0;
  const replaceBalanced = replaceDelta.curly === 0 && replaceDelta.square === 0 && replaceDelta.paren === 0;

  if (searchBalanced && !replaceBalanced) {
    return 'search 中的括号是成对的，但 replace 中不成对，替换后会破坏代码结构。请检查 replace 是否被截断。';
  }

  const searchLines = normalizeToLf(search).split('\n').length;
  const replaceLines = normalizeToLf(replace).split('\n').length;
  const searchBraces = (search.match(/[{}]/g) ?? []).length;
  const replaceBraces = (replace.match(/[{}]/g) ?? []).length;

  if (searchLines >= 5 && replaceLines <= 1 && searchBraces >= 2 && replaceBraces === 0) {
    return `search 覆盖了 ${searchLines} 行含代码块的内容，replace 却只有 1 行且不含任何括号，疑似整段实现被误删。如果确实要删除，请分步进行并说明原因。`;
  }

  return null;
}
