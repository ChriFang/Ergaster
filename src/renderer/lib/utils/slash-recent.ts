/**
 * "/" 指令菜单的「最近使用」持久化。
 * 只存指令/skill 的 name（最近在前、去重），渲染时再和当前可用候选做交集，
 * 避免已删除/未启用的历史项残留。
 */
const STORAGE_KEY = 'ergaster:slash-recent';
const RECENT_LIMIT = 6;

export function readRecentSlashNames(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

/** 记录一次选用：置顶、去重、截断，落盘并返回更新后的列表。 */
export function recordRecentSlashName(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) {
    return readRecentSlashNames();
  }
  const next = [trimmed, ...readRecentSlashNames().filter((item) => item !== trimmed)].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用时退化为纯内存（本次会话生效），不阻断选择
  }
  return next;
}
