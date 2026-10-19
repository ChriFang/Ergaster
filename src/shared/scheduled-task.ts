/**
 * 会话级定时任务：由模型经工具按自然语言创建，到点以子智能体方式运行，
 * 结果追加回归属会话并计入未读。本模块零依赖，可被主/渲染/测试任意引用。
 */

export type ScheduleSpec =
  | { kind: 'once'; runAt: string }
  | { kind: 'daily'; hour: number; minute: number }
  /** weekday：0 为周日，6 为周六（与 Date.getDay 一致）。 */
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'interval'; minutes: number };

export type ScheduledTaskRunStatus = 'success' | 'error' | 'skipped';

export type ScheduledTask = {
  id: string;
  conversationId: string;
  /** 会话归属 scope（智能体 id）。运行时用它决定可用的 Skill / MCP 工具边界。 */
  agentId: string | null;
  name: string;
  /** 交给子智能体的任务描述，必须自包含（子智能体看不到会话历史）。 */
  instruction: string;
  schedule: ScheduleSpec;
  enabled: boolean;
  createdAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: ScheduledTaskRunStatus | null;
  lastError: string | null;
};

/** 每个会话最多允许的定时任务数。 */
export const MAX_TASKS_PER_CONVERSATION = 5;
/** 周期任务的最小间隔，避免把模型请求打爆。 */
export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 60 * 24 * 7;
export const MAX_SCHEDULED_TASK_NAME_LENGTH = 60;
export const MAX_SCHEDULED_TASK_INSTRUCTION_LENGTH = 4000;
/** 单次定时任务运行的整体上限（含模型与工具时间）。 */
export const scheduledTaskRunTimeoutMs = 600_000;

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function padTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 调度规则的中文描述，用于确认弹窗、工具回执与会话内的触发说明。 */
export function describeSchedule(spec: ScheduleSpec): string {
  switch (spec.kind) {
    case 'once':
      return `单次，${formatLocalDateTime(spec.runAt)}`;
    case 'daily':
      return `每天 ${padTime(spec.hour, spec.minute)}`;
    case 'weekly':
      return `每${WEEKDAY_LABELS[spec.weekday] ?? '周日'} ${padTime(spec.hour, spec.minute)}`;
    case 'interval':
      return `每 ${spec.minutes} 分钟`;
    default:
      return '未知调度';
  }
}

/** 本地时区的可读时间（ISO 字符串无法直接给用户看）。 */
export function formatLocalDateTime(iso: string | null): string {
  if (!iso) {
    return '未安排';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day} ${padTime(date.getHours(), date.getMinutes())}`;
}
