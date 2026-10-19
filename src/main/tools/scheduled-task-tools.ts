import { z } from 'zod';
import { conversationService } from '../conversation/conversation-service';
import { scheduledTaskService } from '../scheduler/scheduled-task-service';
import { buildScheduleSpec, type ScheduleToolArgs } from '../scheduler/schedule-spec';
import {
  MAX_INTERVAL_MINUTES,
  MAX_SCHEDULED_TASK_INSTRUCTION_LENGTH,
  MAX_SCHEDULED_TASK_NAME_LENGTH,
  MAX_TASKS_PER_CONVERSATION,
  MIN_INTERVAL_MINUTES,
  describeSchedule,
  formatLocalDateTime,
  type ScheduledTask,
} from '../../shared/scheduled-task';
import { defaultToolTimeoutMs, type ToolDefinition, type ToolResult } from '../../shared/tools';

export const createScheduledTaskToolName = 'create_scheduled_task';
export const deleteScheduledTaskToolName = 'delete_scheduled_task';
export const listScheduledTasksToolName = 'list_scheduled_tasks';

/** 定时任务管理工具自身不应出现在定时任务的运行工具集里（避免任务自我繁殖）。 */
export const scheduledTaskToolNames = [
  createScheduledTaskToolName,
  deleteScheduledTaskToolName,
  listScheduledTasksToolName,
];

const scheduleKinds = ['once', 'daily', 'weekly', 'interval'] as const;

const createScheduledTaskSchema = z.object({
  name: z.string().trim().min(1).max(MAX_SCHEDULED_TASK_NAME_LENGTH),
  instruction: z.string().trim().min(1).max(MAX_SCHEDULED_TASK_INSTRUCTION_LENGTH),
  schedule_kind: z.enum(scheduleKinds),
  run_at: z.string().trim().min(1).max(40).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  interval_minutes: z.number().int().min(1).max(MAX_INTERVAL_MINUTES).optional(),
});

const deleteScheduledTaskSchema = z.object({
  task_id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(MAX_SCHEDULED_TASK_NAME_LENGTH).optional(),
});

const listScheduledTasksSchema = z.object({});

function requireConversationId(conversationId?: string): string | null {
  const normalized = conversationId?.trim();
  return normalized ? normalized : null;
}

function formatTaskLine(index: number, task: ScheduledTask) {
  const status = task.enabled ? `下次运行 ${formatLocalDateTime(task.nextRunAt)}` : '已停用';
  const last = task.lastStatus ? `，上次结果 ${task.lastStatus}` : '';
  return `${index}. 「${task.name}」（${describeSchedule(task.schedule)}）${status}${last}\n   id=${task.id}`;
}

export const scheduledTaskTools: ToolDefinition<unknown>[] = [
  {
    name: createScheduledTaskToolName,
    description:
      '为当前会话创建一个定时任务，到点后由子智能体自动执行，结果会追加回本会话并标记未读。'
      + `每个会话最多 ${MAX_TASKS_PER_CONVERSATION} 个任务。`
      + '创建纪律：执行时间、数据范围、输出要求任何一项不明确时，必须先用 ui_form 向用户确认，不要自行猜测；'
      + 'instruction 必须自包含（执行时看不到本次对话历史，需要的背景、路径、账号、输出格式都要写进去）。'
      + '限制：应用未运行时不会触发，错过的触发不补跑；运行时不会执行高风险工具（执行命令、写文件、发邮件等），'
      + '因此任务应以查询、汇总、整理这类只读操作为主。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '任务名称，简短可辨识，例如「每日邮件摘要」' },
        instruction: { type: 'string', description: '到点要执行的完整任务描述，必须自包含' },
        schedule_kind: {
          type: 'string',
          enum: [...scheduleKinds],
          description: 'once 单次；daily 每天；weekly 每周；interval 每隔固定分钟',
        },
        run_at: { type: 'string', description: 'schedule_kind=once 时的本地执行时间，格式 YYYY-MM-DDTHH:mm' },
        hour: { type: 'number', description: 'schedule_kind=daily/weekly 时的小时（0-23）' },
        minute: { type: 'number', description: 'schedule_kind=daily/weekly 时的分钟（0-59）' },
        weekday: { type: 'number', description: 'schedule_kind=weekly 时的星期（0 为周日，6 为周六）' },
        interval_minutes: {
          type: 'number',
          description: `schedule_kind=interval 时的间隔分钟数（最小 ${MIN_INTERVAL_MINUTES}）`,
        },
      },
      required: ['name', 'instruction', 'schedule_kind'],
      additionalProperties: false,
    },
    validator: createScheduledTaskSchema,
    timeoutMs: defaultToolTimeoutMs,
    source: { type: 'system' },
    buildConfirmation: async (args) => {
      const input = args as z.infer<typeof createScheduledTaskSchema>;
      const built = buildScheduleSpec(input as ScheduleToolArgs, new Date());
      if (!built.ok) {
        return { summary: `创建定时任务「${input.name}」（调度参数有误）`, detail: built.error };
      }

      return {
        summary: `创建定时任务「${input.name}」：${describeSchedule(built.spec)}`,
        detail: [
          `调度：${describeSchedule(built.spec)}`,
          `执行指令：${input.instruction}`,
          '执行方式：到点由子智能体在本会话下自动运行，low/medium 风险工具自动放行，high 风险工具会被拒绝。',
          '应用未运行时不触发，错过的触发不补跑。',
        ].join('\n'),
      };
    },
    execute: async (args, context): Promise<ToolResult> => {
      const input = args as z.infer<typeof createScheduledTaskSchema>;
      const conversationId = requireConversationId(context.conversationId);
      if (!conversationId) {
        return { ok: false, content: '', error: '当前上下文没有会话，无法创建定时任务。' };
      }

      const built = buildScheduleSpec(input as ScheduleToolArgs, new Date());
      if (!built.ok) {
        return { ok: false, content: '', error: built.error };
      }

      const meta = conversationService.getConversationMeta(conversationId);
      if (!meta) {
        return { ok: false, content: '', error: '当前会话已不存在，无法创建定时任务。' };
      }

      const result = await scheduledTaskService.create({
        conversationId,
        agentId: meta.agentId,
        name: input.name,
        instruction: input.instruction,
        schedule: built.spec,
      });

      if (!result.ok || !result.task) {
        return { ok: false, content: '', error: result.error ?? '创建定时任务失败。' };
      }

      return {
        ok: true,
        content: `已创建定时任务「${result.task.name}」：${describeSchedule(result.task.schedule)}，`
          + `下次运行 ${formatLocalDateTime(result.task.nextRunAt)}（id=${result.task.id}）。`,
      };
    },
  },
  {
    name: listScheduledTasksToolName,
    description: '列出当前会话的定时任务（含调度规则、下次运行时间与上次结果）。删除任务前用它拿到 task_id。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    validator: listScheduledTasksSchema,
    timeoutMs: defaultToolTimeoutMs,
    source: { type: 'system' },
    execute: async (_args, context): Promise<ToolResult> => {
      const conversationId = requireConversationId(context.conversationId);
      if (!conversationId) {
        return { ok: false, content: '', error: '当前上下文没有会话，无法查询定时任务。' };
      }

      const tasks = scheduledTaskService.listByConversation(conversationId);
      if (tasks.length === 0) {
        return { ok: true, content: '当前会话没有定时任务。' };
      }

      const lines = tasks.map((task, index) => formatTaskLine(index + 1, task));
      return { ok: true, content: `当前会话共有 ${tasks.length} 个定时任务：\n${lines.join('\n')}` };
    },
  },
  {
    name: deleteScheduledTaskToolName,
    description: '删除当前会话的一个定时任务。传 task_id 最可靠；只给出名称时会在本会话内按名称精确匹配。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '要删除的任务 id（来自 list_scheduled_tasks）' },
        name: { type: 'string', description: '要删除的任务名称，需与已有任务完全一致' },
      },
      required: [],
      additionalProperties: false,
    },
    validator: deleteScheduledTaskSchema,
    timeoutMs: defaultToolTimeoutMs,
    source: { type: 'system' },
    execute: async (args, context): Promise<ToolResult> => {
      const input = args as z.infer<typeof deleteScheduledTaskSchema>;
      const conversationId = requireConversationId(context.conversationId);
      if (!conversationId) {
        return { ok: false, content: '', error: '当前上下文没有会话，无法删除定时任务。' };
      }

      if (!input.task_id && !input.name) {
        return { ok: false, content: '', error: '请提供 task_id 或 name 之一。' };
      }

      const tasks = scheduledTaskService.listByConversation(conversationId);
      const matched = input.task_id
        ? tasks.filter((task) => task.id === input.task_id)
        : tasks.filter((task) => task.name === input.name?.trim());

      if (matched.length === 0) {
        return { ok: false, content: '', error: '当前会话没有匹配的定时任务，请先用 list_scheduled_tasks 确认。' };
      }

      if (matched.length > 1) {
        const lines = matched.map((task, index) => formatTaskLine(index + 1, task));
        return {
          ok: false,
          content: '',
          error: `有多个同名任务，请用 task_id 指定：\n${lines.join('\n')}`,
        };
      }

      const result = await scheduledTaskService.delete(matched[0].id);
      if (!result.ok) {
        return { ok: false, content: '', error: result.error ?? '删除定时任务失败。' };
      }

      return { ok: true, content: `已删除定时任务「${matched[0].name}」。` };
    },
  },
];
