import { Cpu } from 'lucide-react';

import aiProcessingSvg from '../../images/ai-processing-cropped.svg';

type ActivityPanelProps = {
  isRunning: boolean;
  errorMessage: string | null;
};

export function ActivityPanel({ errorMessage }: ActivityPanelProps) {
  if (errorMessage) {
    return (
      <section className="activity-panel activity-panel-error">
        <div className="message-header">
          <span className="message-role">系统</span>
          <div className="message-header-actions">
            <div className="message-status message-status-error">执行失败</div>
          </div>
        </div>
        <div className="message-content">
          <p>{errorMessage}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="activity-running-message" aria-label="系统正在执行">
      <div className="message-row">
        <div className="message-avatar message-avatar-assistant" aria-hidden="true">
          <Cpu size={16} strokeWidth={2} />
        </div>
        <div className="message-stack">
          <div className="message-card-shell activity-panel activity-panel-running activity-panel-running-compact">
            <img className="activity-running-indicator" src={aiProcessingSvg} alt="正在处理" />
          </div>
        </div>
      </div>
    </section>
  );
}
