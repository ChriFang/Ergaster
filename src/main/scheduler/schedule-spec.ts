import {
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  type ScheduleSpec,
} from '../../shared/scheduled-task';

/**
 * 定时任务的纯调度计算：无任何 Electron / fs 依赖，可被 node --test 直接导入。
 * 全部按本地时区计算（用户说"每天 9 点"指的是本机 9 点）。
 */

export type ScheduleBuildResult =
  | { ok: true; spec: ScheduleSpec }
  | { ok: false; error: string };

/** 解析 `2026-09-22T15:30` / `2026-09-22 15:30(:ss)` 这类不带时区的本地时间，其余交给 Date 解析。 */
export function parseLocalDateTime(text: string): Date | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const localMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (localMatch) {
    const [, year, month, day, hour, minute, second] = localMatch;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      second ? Number(second) : 0,
      0,
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 计算严格晚于 from 的下一次触发时间；单次任务已过期时返回 null。 */
export function computeNextRunAt(spec: ScheduleSpec, from: Date): Date | null {
  switch (spec.kind) {
    case 'once': {
      const runAt = parseLocalDateTime(spec.runAt);
      if (!runAt) {
        return null;
      }
      return runAt.getTime() > from.getTime() ? runAt : null;
    }
    case 'daily': {
      const next = new Date(from);
      next.setHours(spec.hour, spec.minute, 0, 0);
      if (next.getTime() <= from.getTime()) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    }
    case 'weekly': {
      const next = new Date(from);
      next.setHours(spec.hour, spec.minute, 0, 0);
      let dayDiff = (spec.weekday - next.getDay() + 7) % 7;
      if (dayDiff === 0 && next.getTime() <= from.getTime()) {
        dayDiff = 7;
      }
      next.setDate(next.getDate() + dayDiff);
      return next;
    }
    case 'interval':
      return new Date(from.getTime() + spec.minutes * 60_000);
    default:
      return null;
  }
}

/** 持久化文件里的调度规则反序列化，字段不合法时返回 null（该任务会被丢弃）。 */
export function parseScheduleSpec(raw: unknown): ScheduleSpec | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const isInteger = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

  switch (candidate.kind) {
    case 'once':
      return typeof candidate.runAt === 'string' && parseLocalDateTime(candidate.runAt)
        ? { kind: 'once', runAt: candidate.runAt }
        : null;
    case 'daily':
      return isInteger(candidate.hour, 0, 23) && isInteger(candidate.minute, 0, 59)
        ? { kind: 'daily', hour: candidate.hour as number, minute: candidate.minute as number }
        : null;
    case 'weekly':
      return isInteger(candidate.weekday, 0, 6) && isInteger(candidate.hour, 0, 23) && isInteger(candidate.minute, 0, 59)
        ? {
          kind: 'weekly',
          weekday: candidate.weekday as number,
          hour: candidate.hour as number,
          minute: candidate.minute as number,
        }
        : null;
    case 'interval':
      return isInteger(candidate.minutes, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)
        ? { kind: 'interval', minutes: candidate.minutes as number }
        : null;
    default:
      return null;
  }
}

export type ScheduleToolArgs = {
  schedule_kind: 'once' | 'daily' | 'weekly' | 'interval';
  run_at?: string;
  hour?: number;
  minute?: number;
  weekday?: number;
  interval_minutes?: number;
};

/**
 * 把工具的扁平参数组装成 ScheduleSpec。
 * 参数缺失/越界在这里给出面向模型的明确错误，避免建出一个永远不触发的任务。
 */
export function buildScheduleSpec(args: ScheduleToolArgs, now: Date): ScheduleBuildResult {
  switch (args.schedule_kind) {
    case 'once': {
      if (!args.run_at) {
        return { ok: false, error: 'schedule_kind 为 once 时必须提供 run_at（例如 2026-09-22T15:30）。' };
      }
      const runAt = parseLocalDateTime(args.run_at);
      if (!runAt) {
        return { ok: false, error: `无法解析 run_at「${args.run_at}」，请使用 YYYY-MM-DDTHH:mm 格式。` };
      }
      if (runAt.getTime() <= now.getTime()) {
        return { ok: false, error: `run_at「${args.run_at}」已是过去时间，请与用户确认新的执行时间。` };
      }
      return { ok: true, spec: { kind: 'once', runAt: args.run_at.trim() } };
    }
    case 'daily': {
      if (args.hour === undefined || args.minute === undefined) {
        return { ok: false, error: 'schedule_kind 为 daily 时必须提供 hour 与 minute。' };
      }
      return { ok: true, spec: { kind: 'daily', hour: args.hour, minute: args.minute } };
    }
    case 'weekly': {
      if (args.weekday === undefined || args.hour === undefined || args.minute === undefined) {
        return { ok: false, error: 'schedule_kind 为 weekly 时必须提供 weekday、hour 与 minute。' };
      }
      return { ok: true, spec: { kind: 'weekly', weekday: args.weekday, hour: args.hour, minute: args.minute } };
    }
    case 'interval': {
      if (args.interval_minutes === undefined) {
        return { ok: false, error: 'schedule_kind 为 interval 时必须提供 interval_minutes。' };
      }
      if (args.interval_minutes < MIN_INTERVAL_MINUTES) {
        return { ok: false, error: `间隔不能小于 ${MIN_INTERVAL_MINUTES} 分钟。` };
      }
      if (args.interval_minutes > MAX_INTERVAL_MINUTES) {
        return { ok: false, error: `间隔不能大于 ${MAX_INTERVAL_MINUTES} 分钟。` };
      }
      return { ok: true, spec: { kind: 'interval', minutes: args.interval_minutes } };
    }
    default:
      return { ok: false, error: '不支持的 schedule_kind。' };
  }
}
