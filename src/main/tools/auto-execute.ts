import type { ToolRisk } from '../../shared/tools';

export type AutoExecuteCandidate = {
  name: string;
  risk: ToolRisk;
};

/**
 * 会话主链路的自动执行判定：
 * - workflow / 子智能体链路（带 workflowMeta）一律不走名单，维持各自 requireConfirmation 策略；
 * - high 风险工具强制弹窗，即使被误配进清单（双保险）；
 * - 其余按全局 autoExecuteTools 清单命中放行。
 */
export function shouldAutoExecute(tool: AutoExecuteCandidate, autoExecuteTools: string[] | undefined, hasWorkflowMeta: boolean): boolean {
  if (hasWorkflowMeta) {
    return false;
  }

  if (tool.risk === 'high') {
    return false;
  }

  return (autoExecuteTools ?? []).includes(tool.name);
}

export type UnattendedApproval = {
  approved: boolean;
  reason?: string;
};

/**
 * 无人值守链路（定时任务）的放行判定：没有人能点确认弹窗，
 * 因此 low/medium 直接放行，high 风险（执行命令、写文件、发邮件等）一律拒绝并把原因回给模型。
 */
export function resolveUnattendedApproval(tool: AutoExecuteCandidate): UnattendedApproval {
  if (tool.risk === 'high') {
    return {
      approved: false,
      reason: `定时任务在无人值守下运行，不会执行高风险工具 ${tool.name}。请改用只读方式完成，或在结果中说明需要用户手动处理。`,
    };
  }

  return { approved: true };
}
