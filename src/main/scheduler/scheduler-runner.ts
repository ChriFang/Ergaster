import { agentService } from '../agent/agent-service';
import { conversationService } from '../conversation/conversation-service';
import { scheduledTaskService } from './scheduled-task-service';
import { getUnattendedToolNames } from '../tools/tool-registry';
import { appendAgentAuditLog, appendMainLog } from '../core/audit-log';
import {
  describeSchedule,
  formatLocalDateTime,
  scheduledTaskRunTimeoutMs,
  type ScheduledTask,
} from '../../shared/scheduled-task';
import type { ChatCompletionApiMessage } from '../agent/deepseek-client';

/** 会话被用户请求占用时的延后步长。 */
const BUSY_POSTPONE_MS = 30_000;
/** 定时器最长睡眠时间：到点前会周期性醒来，规避系统休眠/改表导致的长睡偏差。 */
const MAX_SLEEP_MS = 10 * 60_000;
const MIN_SLEEP_MS = 1_000;

function createScheduledMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildTaskPrompt(task: ScheduledTask, ranAt: Date) {
  return [
    `这是一个定时任务的自动执行，任务名称：${task.name}。`,
    `触发时间：${formatLocalDateTime(ranAt.toISOString())}（调度：${describeSchedule(task.schedule)}）。`,
    '当前没有用户在旁边，无法追问，也不能执行高风险工具（执行命令、写文件、发邮件等会被直接拒绝）。',
    '请基于下面的任务描述完成工作，并输出可直接阅读的结论；信息不足时说明缺什么，不要编造。',
    '',
    '任务描述：',
    task.instruction,
  ].join('\n');
}

/**
 * 定时任务调度循环。
 * 只在应用运行时触发：错过的触发不补跑（加载时已把周期任务前移到下一次）。
 * 单个定时器指向最近到期任务，到点后串行执行到期任务，执行完重排。
 */
class SchedulerRunner {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = true;
  private unsubscribeTasksChanged: (() => void) | null = null;

  start() {
    if (!this.stopped) {
      return;
    }

    this.stopped = false;
    this.unsubscribeTasksChanged = scheduledTaskService.onTasksChanged(() => this.reschedule());
    this.reschedule();
  }

  stop() {
    this.stopped = true;
    this.unsubscribeTasksChanged?.();
    this.unsubscribeTasksChanged = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 按最近一次触发时间重排定时器。任务增删改后由 onTasksChanged 自动调用。 */
  private reschedule() {
    if (this.stopped) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // tick 进行中：本轮结束时会自行重排，避免重复排程
    if (this.ticking) {
      return;
    }

    const next = scheduledTaskService.getNextRunAt();
    if (!next) {
      return;
    }

    const delay = Math.min(Math.max(next.getTime() - Date.now(), MIN_SLEEP_MS), MAX_SLEEP_MS);
    this.timer = setTimeout(() => {
      void this.tick();
    }, delay);
  }

  private async tick() {
    this.ticking = true;
    try {
      const due = scheduledTaskService.getDueTasks(new Date());
      for (const task of due) {
        if (this.stopped) {
          break;
        }
        await this.runTask(task);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Scheduler tick failed: ${message}`);
    } finally {
      this.ticking = false;
      this.reschedule();
    }
  }

  private async runTask(task: ScheduledTask) {
    const ranAt = new Date();

    // 会话已被删除（级联清理未跑到）：顺带删掉任务
    if (!conversationService.getConversationMeta(task.conversationId)) {
      await scheduledTaskService.delete(task.id);
      await appendMainLog('INFO', `Scheduled task dropped, conversation missing: id=${task.id}`);
      return;
    }

    // 该会话正在被用户请求占用：延后触发，避免与 run 收尾的整份落盘互相覆盖
    if (agentService.isConversationBusy(task.conversationId)) {
      await scheduledTaskService.postpone(task.id, new Date(Date.now() + BUSY_POSTPONE_MS));
      await appendMainLog('INFO', `Scheduled task postponed, conversation busy: id=${task.id}`);
      return;
    }

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), scheduledTaskRunTimeoutMs);

    await appendMainLog('INFO', `Scheduled task started: id=${task.id} name=${task.name}`);
    await appendAgentAuditLog({
      timestamp: ranAt.toISOString(),
      status: 'started',
      summary: `定时任务「${task.name}」触发`,
      detail: `conversation=${task.conversationId} schedule=${describeSchedule(task.schedule)}`,
    });

    try {
      const allowedToolNames = await getUnattendedToolNames(task.agentId ?? undefined);
      const message = await agentService.runSubagent({
        task: buildTaskPrompt(task, ranAt),
        role: '定时任务执行者',
        label: task.name,
        agentId: task.agentId ?? undefined,
        allowedToolNames,
        depth: 1,
        signal: controller.signal,
        approvalMode: 'unattended-safe',
      });

      const resultText = message.content.trim() || '（定时任务没有返回内容）';
      await this.appendTaskMessages(task, ranAt, resultText);
      await scheduledTaskService.markRun(task.id, { status: 'success', ranAt });
      await appendMainLog('INFO', `Scheduled task finished: id=${task.id}`);
      await appendAgentAuditLog({
        timestamp: new Date().toISOString(),
        status: 'success',
        summary: `定时任务「${task.name}」完成`,
        detail: resultText,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '定时任务执行失败。';
      await this.appendTaskMessages(task, ranAt, `定时任务执行失败：${message}`);
      await scheduledTaskService.markRun(task.id, { status: 'error', ranAt, error: message });
      await appendMainLog('ERROR', `Scheduled task failed: id=${task.id} error=${message}`);
      await appendAgentAuditLog({
        timestamp: new Date().toISOString(),
        status: 'error',
        summary: `定时任务「${task.name}」失败`,
        detail: message,
      });
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  /** 触发说明 + 执行结果各一条追加进归属会话，并累加未读。 */
  private async appendTaskMessages(task: ScheduledTask, ranAt: Date, resultText: string) {
    const triggerMessage: ChatCompletionApiMessage = {
      id: createScheduledMessageId('user-scheduled'),
      role: 'user',
      content: `[定时任务] ${task.name}（${describeSchedule(task.schedule)}）于 ${formatLocalDateTime(ranAt.toISOString())} 触发：\n${task.instruction}`,
    };
    const resultMessage: ChatCompletionApiMessage = {
      id: createScheduledMessageId('assistant-scheduled'),
      role: 'assistant',
      content: resultText,
    };

    await conversationService.appendMessages(task.conversationId, [triggerMessage, resultMessage]);
    await conversationService.incrementUnread(task.conversationId, 1);
  }
}

export const schedulerRunner = new SchedulerRunner();
