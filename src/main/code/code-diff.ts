/**
 * 纯函数版 unified diff 生成。仅供代码编辑工具在确认弹窗与工具结果里展示改动，
 * 不追求与 git diff 字节级一致，但保证 hunk 头的行号与上下文可读、可核对。
 */

/** 超过该行数就不做逐行 LCS，避免大文件把主进程算住。 */
export const maxDiffLines = 3000;

type DiffOp = {
  kind: 'equal' | 'remove' | 'add';
  oldIndex: number;
  newIndex: number;
  text: string;
};

function splitLines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const lines = text.split('\n');
  // 末尾换行会产生一个空串，去掉它以免多出一行空 diff
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/** 逐行 LCS。返回按原顺序排列的编辑操作序列。 */
function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const width = newCount + 1;
  const table = new Int32Array((oldCount + 1) * width);

  for (let i = oldCount - 1; i >= 0; i -= 1) {
    for (let j = newCount - 1; j >= 0; j -= 1) {
      table[i * width + j] = oldLines[i] === newLines[j]
        ? table[(i + 1) * width + (j + 1)] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;

  while (i < oldCount && j < newCount) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ kind: 'equal', oldIndex: i, newIndex: j, text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      ops.push({ kind: 'remove', oldIndex: i, newIndex: j, text: oldLines[i] });
      i += 1;
    } else {
      ops.push({ kind: 'add', oldIndex: i, newIndex: j, text: newLines[j] });
      j += 1;
    }
  }

  while (i < oldCount) {
    ops.push({ kind: 'remove', oldIndex: i, newIndex: j, text: oldLines[i] });
    i += 1;
  }

  while (j < newCount) {
    ops.push({ kind: 'add', oldIndex: i, newIndex: j, text: newLines[j] });
    j += 1;
  }

  return ops;
}

export type DiffStats = {
  added: number;
  removed: number;
};

export function buildDiffStats(oldText: string, newText: string): DiffStats {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  if (oldLines.length > maxDiffLines || newLines.length > maxDiffLines) {
    return { added: newLines.length, removed: oldLines.length };
  }

  const ops = diffLines(oldLines, newLines);
  return {
    added: ops.filter((op) => op.kind === 'add').length,
    removed: ops.filter((op) => op.kind === 'remove').length,
  };
}

/**
 * 生成 unified diff 文本。文件过大时退化为"整体替换"的概要，而不是拒绝输出，
 * 保证确认弹窗永远有内容可展示。
 */
export function buildUnifiedDiff(displayPath: string, oldText: string, newText: string, contextLines = 3): string {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const header = `--- ${displayPath}\n+++ ${displayPath}`;

  if (oldText === newText) {
    return `${header}\n(内容无变化)`;
  }

  if (oldLines.length > maxDiffLines || newLines.length > maxDiffLines) {
    return `${header}\n@@ 文件超过 ${maxDiffLines} 行，未生成逐行 diff @@\n-（原有 ${oldLines.length} 行）\n+（写入后 ${newLines.length} 行）`;
  }

  const ops = diffLines(oldLines, newLines);
  const changedIndexes = ops
    .map((op, index) => (op.kind === 'equal' ? -1 : index))
    .filter((index) => index >= 0);

  if (changedIndexes.length === 0) {
    return `${header}\n(内容无变化)`;
  }

  // 把相邻的改动按上下文窗口合并成 hunk
  const ranges: Array<{ from: number; to: number }> = [];
  for (const index of changedIndexes) {
    const from = Math.max(index - contextLines, 0);
    const to = Math.min(index + contextLines, ops.length - 1);
    const last = ranges[ranges.length - 1];
    if (last && from <= last.to + 1) {
      last.to = Math.max(last.to, to);
    } else {
      ranges.push({ from, to });
    }
  }

  const blocks = ranges.map((range) => {
    const slice = ops.slice(range.from, range.to + 1);
    const oldStart = (slice.find((op) => op.kind !== 'add')?.oldIndex ?? slice[0].oldIndex) + 1;
    const newStart = (slice.find((op) => op.kind !== 'remove')?.newIndex ?? slice[0].newIndex) + 1;
    const oldCount = slice.filter((op) => op.kind !== 'add').length;
    const newCount = slice.filter((op) => op.kind !== 'remove').length;
    const body = slice.map((op) => {
      const prefix = op.kind === 'equal' ? ' ' : op.kind === 'add' ? '+' : '-';
      return `${prefix}${op.text}`;
    });

    return [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body].join('\n');
  });

  return [header, ...blocks].join('\n');
}
