import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  applyLineEnding,
  createIgnoreMatcher,
  detectDominantLineEnding,
  detectStructuralLoss,
  findUniqueMatch,
  formatNumberedLines,
  getNewFileExtensionDenialReason,
  getWriteDenialReason,
  looksBinary,
  matchGlob,
  normalizePunctuation,
  parseIgnorePatterns,
  resolveProjectPath,
  toProjectRelativePath,
} from './code-tools-utils';

const projectRoot = path.resolve('/tmp/demo-project');

test('matchGlob 区分单星与双星的跨目录能力', () => {
  assert.equal(matchGlob('*.ts', 'index.ts'), true);
  assert.equal(matchGlob('*.ts', 'src/index.ts'), false);
  assert.equal(matchGlob('src/**/*.tsx', 'src/features/a/B.tsx'), true);
  assert.equal(matchGlob('src/**/*.tsx', 'src/B.tsx'), true);
  assert.equal(matchGlob('src/**/*.tsx', 'lib/B.tsx'), false);
  assert.equal(matchGlob('a?c.ts', 'abc.ts'), true);
  assert.equal(matchGlob('a?c.ts', 'abbc.ts'), false);
});

test('matchGlob 不把模式里的正则元字符当成正则', () => {
  assert.equal(matchGlob('a+b.ts', 'a+b.ts'), true);
  assert.equal(matchGlob('a+b.ts', 'aab.ts'), false);
  assert.equal(matchGlob('index.ts', 'indexXts'), false);
});

test('parseIgnorePatterns 跳过注释与空行并识别取反、目录限定', () => {
  const rules = parseIgnorePatterns(['# comment', '', 'dist', 'build/', '!build/keep', '/root-only'].join('\n'));

  assert.equal(rules.length, 4);
  assert.deepEqual(rules[0], { pattern: 'dist', negated: false, directoryOnly: false, anchored: false });
  assert.equal(rules[1].directoryOnly, true);
  assert.equal(rules[2].negated, true);
  assert.equal(rules[3].anchored, true);
});

test('createIgnoreMatcher 按 gitignore 语义判定，后置规则覆盖前置规则', () => {
  const isIgnored = createIgnoreMatcher(parseIgnorePatterns(['*.log', 'dist/', '!dist/keep.txt'].join('\n')));

  assert.equal(isIgnored('debug.log', false), true);
  assert.equal(isIgnored('nested/debug.log', false), true);
  assert.equal(isIgnored('src/index.ts', false), false);
  assert.equal(isIgnored('dist', true), true);
  // 目录限定规则不应命中同名文件
  assert.equal(isIgnored('dist', false), false);
  assert.equal(isIgnored('dist/keep.txt', false), false);
});

test('resolveProjectPath 把相对路径限制在工程根内', () => {
  assert.equal(resolveProjectPath(projectRoot, '.'), projectRoot);
  assert.equal(resolveProjectPath(projectRoot, ''), projectRoot);
  assert.equal(resolveProjectPath(projectRoot, 'src/index.ts'), path.join(projectRoot, 'src/index.ts'));
  assert.equal(resolveProjectPath(projectRoot, 'src/../lib/a.ts'), path.join(projectRoot, 'lib/a.ts'));
  // 工程内的绝对路径直接接受，方便模型照抄提示词里的工程根目录
  assert.equal(resolveProjectPath(projectRoot, path.join(projectRoot, 'src/index.ts')), path.join(projectRoot, 'src/index.ts'));
});

test('resolveProjectPath 拒绝越界路径', () => {
  assert.throws(() => resolveProjectPath(projectRoot, '../secrets.txt'), /超出/);
  assert.throws(() => resolveProjectPath(projectRoot, 'src/../../secrets.txt'), /超出/);
  assert.throws(() => resolveProjectPath(projectRoot, `${projectRoot}-sibling/a.ts`), /超出/);
  assert.throws(() => resolveProjectPath(projectRoot, '/etc/passwd'), /超出/);
});

test('toProjectRelativePath 输出斜杠分隔的相对路径', () => {
  assert.equal(toProjectRelativePath(projectRoot, path.join(projectRoot, 'src', 'a.ts')), 'src/a.ts');
  assert.equal(toProjectRelativePath(projectRoot, projectRoot), '');
});

test('formatNumberedLines 按最大行号右对齐补齐宽度', () => {
  assert.equal(formatNumberedLines(['a', 'b'], 9), ' 9\ta\n10\tb');
  assert.equal(formatNumberedLines(['only'], 1), '1\tonly');
});

test('looksBinary 以 NUL 字节判定二进制', () => {
  assert.equal(looksBinary(Buffer.from('plain text')), false);
  assert.equal(looksBinary(Buffer.from([0x61, 0x00, 0x62])), true);
});

test('getWriteDenialReason 拦住仓库元数据、依赖目录与锁文件', () => {
  assert.match(getWriteDenialReason('.git/config') ?? '', /\.git/);
  assert.match(getWriteDenialReason('src/node_modules/a/index.js') ?? '', /node_modules/);
  assert.match(getWriteDenialReason('package-lock.json') ?? '', /锁文件|凭证/);
  assert.match(getWriteDenialReason('.env') ?? '', /锁文件|凭证/);
  assert.match(getWriteDenialReason('') ?? '', /工程根目录/);
  assert.equal(getWriteDenialReason('src/main/index.ts'), null);
  // 名字里带 .git 的普通文件不该被误拦
  assert.equal(getWriteDenialReason('.gitignore'), null);
});

test('getNewFileExtensionDenialReason 只放行常见源码与文本文件', () => {
  assert.equal(getNewFileExtensionDenialReason('src/a.ts'), null);
  assert.equal(getNewFileExtensionDenialReason('docs/readme.md'), null);
  assert.equal(getNewFileExtensionDenialReason('Dockerfile'), null);
  assert.equal(getNewFileExtensionDenialReason('.gitignore'), null);
  assert.match(getNewFileExtensionDenialReason('a.exe') ?? '', /不支持新建/);
  assert.match(getNewFileExtensionDenialReason('bin/tool') ?? '', /不支持新建/);
});

test('行尾判定与还原保持文件原有风格', () => {
  assert.equal(detectDominantLineEnding('a\r\nb\r\n'), '\r\n');
  assert.equal(detectDominantLineEnding('a\nb\n'), '\n');
  assert.equal(detectDominantLineEnding(''), '\n');
  assert.equal(applyLineEnding('a\nb', '\r\n'), 'a\r\nb');
  assert.equal(applyLineEnding('a\r\nb', '\n'), 'a\nb');
});

test('normalizePunctuation 等长替换排版字符', () => {
  const source = '\u201Chi\u201D \u2014 \u2018x\u2019\u00A0y';
  const normalized = normalizePunctuation(source);
  assert.equal(normalized, '"hi" - \'x\' y');
  assert.equal(normalized.length, source.length);
});

test('findUniqueMatch 精确匹配唯一命中', () => {
  const haystack = 'const a = 1;\nconst b = 2;\n';
  const match = findUniqueMatch(haystack, 'const b = 2;');
  assert.deepEqual(match, { start: 13, end: 25, kind: 'exact' });
});

test('findUniqueMatch 命中多处时报错而不是取第一个', () => {
  assert.throws(() => findUniqueMatch('x\nx\n', 'x'), /出现了 2 次/);
});

test('findUniqueMatch 依次回退到缩进不敏感与排版归一化', () => {
  // 缩进宽度不一致导致精确匹配失败时，按整行忽略前导空白重新定位
  const haystack = 'function a() {\n    if (x) {\n        y();\n    }\n}\n';
  const indented = findUniqueMatch(haystack, '  if (x) {\n      y();\n  }');
  assert.equal(indented.kind, 'indentation');
  assert.equal(haystack.slice(indented.start, indented.end), '    if (x) {\n        y();\n    }');

  const punctuation = findUniqueMatch('const s = "hi";\n', 'const s = \u201Chi\u201D;');
  assert.equal(punctuation.kind, 'punctuation');
});

test('findUniqueMatch 找不到内容时提示先读取文件', () => {
  assert.throws(() => findUniqueMatch('const a = 1;\n', 'const z = 9;'), /找不到 search/);
  assert.throws(() => findUniqueMatch('a', ''), /不能为空/);
});

test('detectStructuralLoss 拦住括号失衡与整段塌缩', () => {
  assert.match(detectStructuralLoss('if (a) { b(); }', 'if (a) { b();') ?? '', /括号/);
  const bigBlock = 'function a() {\n  if (x) {\n    y();\n  }\n  return 1;\n}';
  assert.match(detectStructuralLoss(bigBlock, '// removed') ?? '', /疑似整段实现被误删/);
  assert.equal(detectStructuralLoss('const a = 1;', 'const a = 2;'), null);
  // replace 为空的删除场景不应被括号规则误伤
  assert.equal(detectStructuralLoss('const a = 1;\n', ''), null);
});
