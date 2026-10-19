import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getAppDataRoot } from '../core/app-paths';
import { appendMainLog } from '../core/audit-log';
import {
  MAX_SCHEDULED_TASK_INSTRUCTION_LENGTH,
  MAX_SCHEDULED_TASK_NAME_LENGTH,
  MAX_TASKS_PER_CONVERSATION,
  describeSchedule,
  type ScheduleSpec,
  type ScheduledTask,
  type ScheduledTaskRunStatus,
} from '../../shared/scheduled-task';
import { computeNextRunAt, parseScheduleSpec } from './schedule-spec';

const TASKS_FILE_NAME = 'tasks.json';

export type CreateScheduledTaskInput = {
  conversationId: string;
  agentId: string | null;
  name: string;
  instruction: string;
  schedule: ScheduleSpec;
};

export type ScheduledTaskOperationResult = {
  ok: boolean;
  task?: ScheduledTask;
  error?: string;
};

function normalizeTask(raw: unknown): ScheduledTask | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const schedule = parseScheduleSpec(candidate.schedule);
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const conversationId = typeof candidate.conversationId === 'string' ? candidate.conversationId.trim() : '';
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  const instruction = typeof candidate.instruction === 'string' ? candidate.instruction.trim() : '';

  if (!schedule || !id || !conversationId || !name || !instruction) {
    return null;
  }

  return {
    id,
    conversationId,
    agentId: typeof candidate.agentId === 'string' ? candidate.agentId : null,
    name: name.slice(0, MAX_SCHEDULED_TASK_NAME_LENGTH),
    instruction: instruction.slice(0, MAX_SCHEDULED_TASK_INSTRUCTION_LENGTH),
    schedule,
    enabled: candidate.enabled !== false,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
    nextRunAt: typeof candidate.nextRunAt === 'string' ? candidate.nextRunAt : null,
    lastRunAt: typeof candidate.lastRunAt === 'string' ? candidate.lastRunAt : null,
    lastStatus: (candidate.lastStatus as ScheduledTaskRunStatus | null) ?? null,
    lastError: typeof candidate.lastError === 'string' ? candidate.lastError : null,
  };
}

/**
 * 定时任务的持久化与生命周期管理。
 * 只依赖 fs / app-paths，不认识 agent 与调度循环：
 * 任务变更经 onTasksChanged 通知 scheduler-runner 重排定时器，避免与执行侧形成循环依赖。
 */
class ScheduledTaskService {
  private readonly tasksDir = path.join(getAppDataRoot(), 'scheduled-tasks');
  private readonly tasksFilePath = path.join(this.tasksDir, TASKS_FILE_NAME);
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly changeListeners = new Set<() => void>();

  onTasksChanged(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private emitTasksChanged() {
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  getTasksFilePath() {
    return this.tasksFilePath;
  }

  /**
   * 启动加载。错过的触发一律不补跑（应用未运行时不触发）：
   * 周期任务按当前时间前移到下一次，单次任务过期则直接停用。
   */
  async load(): Promise<void> {
    this.tasks.clear();

    try {
      const raw = await fs.readFile(this.tasksFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed) ? parsed : [];
      for (const entry of entries) {
        const task = normalizeTask(entry);
        if (task) {
          this.tasks.set(task.id, task);
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await appendMainLog('ERROR', `Failed to load scheduled tasks: ${message}`);
      }
    }

    const now = new Date();
    let changed = false;
    for (const task of this.tasks.values()) {
      if (!task.enabled) {
        continue;
      }

      const dueAt = task.nextRunAt ? new Date(task.nextRunAt) : null;
      if (dueAt && !Number.isNaN(dueAt.getTime()) && dueAt.getTime() > now.getTime()) {
        continue;
      }

      const next = computeNextRunAt(task.schedule, now);
      task.nextRunAt = next ? next.toISOString() : null;
      if (!next) {
        task.enabled = false;
      }
      changed = true;
    }

    if (changed) {
      await this.persist();
    }

    await appendMainLog('INFO', `Loaded ${this.tasks.size} scheduled tasks from ${this.tasksFilePath}`);
    this.emitTasksChanged();
  }

  listAll(): ScheduledTask[] {
    return Array.from(this.tasks.values()).map((task) => ({ ...task }));
  }

  listByConversation(conversationId: string): ScheduledTask[] {
    return this.listAll()
      .filter((task) => task.conversationId === conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getTask(id: string): ScheduledTask | null {
    const task = this.tasks.get(id);
    return task ? { ...task } : null;
  }

  async create(input: CreateScheduledTaskInput): Promise<ScheduledTaskOperationResult> {
    const name = input.name.trim().slice(0, MAX_SCHEDULED_TASK_NAME_LENGTH);
    const instruction = input.instruction.trim().slice(0, MAX_SCHEDULED_TASK_INSTRUCTION_LENGTH);
    if (!name || !instruction) {
      return { ok: false, error: '定时任务的名称与执行指令都不能为空。' };
    }

    const existing = this.listByConversation(input.conversationId);
    if (existing.length >= MAX_TASKS_PER_CONVERSATION) {
      return {
        ok: false,
        error: `当前会话的定时任务已达上限（${MAX_TASKS_PER_CONVERSATION} 个），请先删除不需要的任务。`,
      };
    }

    const next = computeNextRunAt(input.schedule, new Date());
    if (!next) {
      return { ok: false, error: '该调度规则不会再触发，请确认执行时间。' };
    }

    const task: ScheduledTask = {
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      agentId: input.agentId,
      name,
      instruction,
      schedule: input.schedule,
      enabled: true,
      createdAt: new Date().toISOString(),
      nextRunAt: next.toISOString(),
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
    };

    this.tasks.set(task.id, task);
    await this.persist();
    await appendMainLog(
      'INFO',
      `Scheduled task created: id=${task.id} conversation=${task.conversationId} schedule=${describeSchedule(task.schedule)}`,
    );
    this.emitTasksChanged();
    return { ok: true, task: { ...task } };
  }

  async delete(id: string): Promise<ScheduledTaskOperationResult> {
    const task = this.tasks.get(id);
    if (!task) {
      return { ok: false, error: `未找到 id 为 "${id}" 的定时任务。` };
    }

    this.tasks.delete(id);
    await this.persist();
    await appendMainLog('INFO', `Scheduled task deleted: id=${id}`);
    this.emitTasksChanged();
    return { ok: true, task };
  }

  /** 会话被删除时级联清理，由 index.ts 接线到 conversationService 的删除事件。 */
  async deleteByConversation(conversationId: string): Promise<number> {
    const targets = this.listByConversation(conversationId);
    if (targets.length === 0) {
      return 0;
    }

    for (const task of targets) {
      this.tasks.delete(task.id);
    }
    await this.persist();
    await appendMainLog('INFO', `Scheduled tasks deleted with conversation ${conversationId}: count=${targets.length}`);
    this.emitTasksChanged();
    return targets.length;
  }

  /** 到期任务（含因会话忙碌被延后的）。 */
  getDueTasks(now: Date): ScheduledTask[] {
    return this.listAll()
      .filter((task) => task.enabled && task.nextRunAt !== null && new Date(task.nextRunAt).getTime() <= now.getTime())
      .sort((left, right) => (left.nextRunAt ?? '').localeCompare(right.nextRunAt ?? ''));
  }

  getNextRunAt(): Date | null {
    let earliest: Date | null = null;
    for (const task of this.tasks.values()) {
      if (!task.enabled || !task.nextRunAt) {
        continue;
      }
      const candidate = new Date(task.nextRunAt);
      if (Number.isNaN(candidate.getTime())) {
        continue;
      }
      if (!earliest || candidate.getTime() < earliest.getTime()) {
        earliest = candidate;
      }
    }
    return earliest;
  }

  /** 记录一次运行结果并前移到下一次触发；单次任务运行后停用。 */
  async markRun(id: string, input: { status: ScheduledTaskRunStatus; ranAt: Date; error?: string }): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) {
      return;
    }

    const next = computeNextRunAt(task.schedule, input.ranAt);
    task.lastRunAt = input.ranAt.toISOString();
    task.lastStatus = input.status;
    task.lastError = input.error ?? null;
    task.nextRunAt = next ? next.toISOString() : null;
    if (!next || task.schedule.kind === 'once') {
      task.enabled = false;
      task.nextRunAt = null;
    }

    await this.persist();
    this.emitTasksChanged();
  }

  /** 会话正忙时把触发推迟一小段时间，避免与用户请求争抢同一会话的落盘。 */
  async postpone(id: string, until: Date): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) {
      return;
    }

    task.nextRunAt = until.toISOString();
    await this.persist();
    this.emitTasksChanged();
  }

  private async persist(): Promise<void> {
    try {
      await fs.mkdir(this.tasksDir, { recursive: true });
      const payload = `${JSON.stringify(this.listAll(), null, 2)}\n`;
      await fs.writeFile(this.tasksFilePath, payload, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to persist scheduled tasks: ${message}`);
    }
  }
}

export const scheduledTaskService = new ScheduledTaskService();
