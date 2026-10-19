import { useState } from 'react';
import type { ToolConfirmationRequest } from '../../../shared/tools';

type ConfirmationPanelProps = {
  confirmationRequest: ToolConfirmationRequest;
  onApprove: (autoRun: boolean, autoAllowCommand: boolean, autoAllowDomain: boolean) => void;
  onReject: () => void;
};

/** 按 unified diff 的行首字符上色，让新增/删除/hunk 头一眼可辨。 */
function getDiffLineClassName(line: string) {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return 'confirm-diff-line confirm-diff-line-file';
  }
  if (line.startsWith('@@')) {
    return 'confirm-diff-line confirm-diff-line-hunk';
  }
  if (line.startsWith('+')) {
    return 'confirm-diff-line confirm-diff-line-add';
  }
  if (line.startsWith('-')) {
    return 'confirm-diff-line confirm-diff-line-remove';
  }
  return 'confirm-diff-line';
}

export function ConfirmationPanel({ confirmationRequest, onApprove, onReject }: ConfirmationPanelProps) {
  const diffLines = confirmationRequest.diff ? confirmationRequest.diff.split('\n') : [];
  const [autoRun, setAutoRun] = useState(false);
  const [autoAllowCommand, setAutoAllowCommand] = useState(false);
  const [autoAllowDomain, setAutoAllowDomain] = useState(false);
  const canAutoRun = Boolean(confirmationRequest.canAutoRun);
  // 命令白名单勾选：仅当主进程给出建议前缀（未命中黑名单/危险模式）时展示
  const commandAutoAllow = confirmationRequest.commandAutoAllow ?? '';
  // 下载域名白名单勾选：仅 download_file 且域名不在白名单时展示
  const domainAutoAllow = confirmationRequest.domainAutoAllow ?? '';

  return (
    <section className="confirm-panel">
      <div>
        <h3>确认工具执行</h3>
        <p className="settings-description">{confirmationRequest.summary}</p>
        {confirmationRequest.detail ? <p className="confirm-risk">{confirmationRequest.detail}</p> : null}
        <p className="confirm-risk">工具：{confirmationRequest.toolName}</p>
        <p className="confirm-risk">风险等级：{confirmationRequest.risk}</p>
      </div>
      {diffLines.length > 0 ? (
        <div className="confirm-diff" role="group" aria-label="改动预览">
          {diffLines.map((line, index) => (
            <div key={`${index}-${line}`} className={getDiffLineClassName(line)}>
              {line || ' '}
            </div>
          ))}
        </div>
      ) : null}
      <div className="composer-button-group">
        {canAutoRun ? (
          <label className="confirm-auto-run">
            <input
              type="checkbox"
              checked={autoRun}
              onChange={(event) => setAutoRun(event.target.checked)}
              disabled={!canAutoRun}
            />
            <span>自动运行并记住（全局）</span>
          </label>
        ) : null}
        {commandAutoAllow ? (
          <label className="confirm-auto-run">
            <input
              type="checkbox"
              checked={autoAllowCommand}
              onChange={(event) => setAutoAllowCommand(event.target.checked)}
            />
            <span>总是允许此命令「{commandAutoAllow}」（写入全局命令白名单）</span>
          </label>
        ) : null}
        {domainAutoAllow ? (
          <label className="confirm-auto-run">
            <input
              type="checkbox"
              checked={autoAllowDomain}
              onChange={(event) => setAutoAllowDomain(event.target.checked)}
            />
            <span>总是允许从此域名下载「{domainAutoAllow}」（写入下载域名白名单）</span>
          </label>
        ) : null}
        <button className="ghost-button" type="button" onClick={onReject}>
          拒绝
        </button>
        <button className="primary-button" type="button" onClick={() => onApprove(autoRun, autoAllowCommand, autoAllowDomain)}>
          确认执行
        </button>
      </div>
    </section>
  );
}
