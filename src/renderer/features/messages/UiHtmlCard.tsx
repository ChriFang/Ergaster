import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWindow, ExternalLink, TriangleAlert } from 'lucide-react';
import type { UiHtmlWidgetItem } from '../../lib/hooks/use-chat-session';
import { buildUiHtmlDataUrl } from '../../lib/utils/ui-html-document';

type UiHtmlCardProps = {
  item: UiHtmlWidgetItem;
  /** 有任意会话在后端执行时禁用提交（后端单例）。 */
  disabled: boolean;
  /** 是否已弹出到独立窗口：为真时内联降级为占位，独立窗口作为唯一交互实例。 */
  poppedOut: boolean;
  onSubmit: (widgetId: string, data: Record<string, unknown>) => void;
  /** 打开独立窗口。 */
  onPopOut: (widgetId: string) => void;
  /** 收回独立窗口（关闭它并恢复内联）。 */
  onReclaim: (widgetId: string) => void;
};

/** 交互式 HTML 默认尽量占满会话区高度：内容高度在 [视口*0.5, 视口*0.85] 间自适应。 */
const FRAME_MIN_RATIO = 0.5;
const FRAME_MAX_RATIO = 0.85;
const FRAME_FALLBACK_VH = 800;
/** 错误面板最多展示的条数与单条长度。 */
const MAX_ERRORS = 4;
const MAX_ERROR_LENGTH = 240;

type BridgeMessage = {
  __agentUi?: unknown;
  widgetId?: unknown;
  nonce?: unknown;
  type?: unknown;
  height?: unknown;
  data?: unknown;
  message?: unknown;
};

function computeFrameBounds() {
  const vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : FRAME_FALLBACK_VH;
  return { min: Math.round(vh * FRAME_MIN_RATIO), max: Math.round(vh * FRAME_MAX_RATIO) };
}

/** 会话区交互式 HTML 卡片：由 render_ui 工具推送，sandbox iframe（data: URL）承载，提交与错误经 postMessage 回流。 */
export function UiHtmlCard({ item, disabled, poppedOut, onSubmit, onPopOut, onReclaim }: UiHtmlCardProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // 每次挂载生成一次性 nonce：只存在于 renderer，不进 payload/落盘，用于校验回传消息来源
  const nonceRef = useRef<string>('');
  if (!nonceRef.current) {
    nonceRef.current = crypto.randomUUID();
  }
  const nonce = nonceRef.current;

  const doc = useMemo(() => buildUiHtmlDataUrl(item.spec, nonce), [item.spec, nonce]);
  const [height, setHeight] = useState(() => computeFrameBounds().min);
  // 沙箱内脚本错误 / CSP 违规回传，展示在卡片底部便于排查
  const [errors, setErrors] = useState<string[]>([]);

  // 用 ref 持有最新的回调与状态，避免因它们变化而反复重挂监听
  const onSubmitRef = useRef(onSubmit);
  const submittedRef = useRef(item.submitted);
  const disabledRef = useRef(disabled);
  onSubmitRef.current = onSubmit;
  submittedRef.current = item.submitted;
  disabledRef.current = disabled;

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // data: URL 的 origin 同样是 "null"，必须用 source 精确匹配本 iframe
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      const payload = event.data as BridgeMessage | null;
      if (!payload || payload.__agentUi !== true || payload.nonce !== nonce || payload.widgetId !== item.widgetId) {
        return;
      }
      if (payload.type === 'resize' && typeof payload.height === 'number') {
        const { min, max } = computeFrameBounds();
        setHeight(Math.max(min, Math.min(max, payload.height)));
        return;
      }
      if (payload.type === 'error' && typeof payload.message === 'string') {
        const text = payload.message.slice(0, MAX_ERROR_LENGTH);
        setErrors((prev) => [...prev.slice(-(MAX_ERRORS - 1)), text]);
        return;
      }
      if (payload.type === 'submit') {
        if (submittedRef.current || disabledRef.current) {
          return;
        }
        const data = payload.data && typeof payload.data === 'object' ? (payload.data as Record<string, unknown>) : {};
        onSubmitRef.current(item.widgetId, data);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [nonce, item.widgetId]);

  // 窗口尺寸变化时按新视口重新夹取高度，保持“尽量占满”而不溢出
  useEffect(() => {
    function handleResize() {
      const { min, max } = computeFrameBounds();
      setHeight((current) => Math.max(min, Math.min(max, current)));
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <article className="message message-assistant ui-html-card">
      <div className="message-row">
        <div className="message-avatar message-avatar-tool" aria-hidden="true">
          <AppWindow size={16} strokeWidth={2} />
        </div>
        <div className="message-stack">
          <div className="message-card-shell ui-html-shell">
            <div className="ui-form-header">
              <span className="ui-form-title">{item.spec.title}</span>
              {item.submitted ? <span className="ui-form-status">已提交</span> : null}
              <div className="ui-html-header-actions">
                {poppedOut ? (
                  <button type="button" className="ui-html-popout-btn" onClick={() => onReclaim(item.widgetId)}>
                    <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
                    收回窗口
                  </button>
                ) : (
                  <button type="button" className="ui-html-popout-btn" onClick={() => onPopOut(item.widgetId)}>
                    <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
                    弹出窗口
                  </button>
                )}
              </div>
            </div>
            {poppedOut ? (
              <div className="ui-html-popped-placeholder">
                <span>已在独立窗口中打开，交互与提交都在该窗口进行。</span>
                <button type="button" className="ui-html-popout-btn" onClick={() => onReclaim(item.widgetId)}>
                  <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
                  收回并恢复内联显示
                </button>
              </div>
            ) : (
              <iframe
                ref={iframeRef}
                className="ui-html-frame"
                title={item.spec.title}
                // allow-forms 必需：缺它时浏览器在「提交表单」算法里遇到 sandboxed forms 标志就直接返回，
                // <form> 的 submit 事件根本不会触发，桥接脚本也就捕获不到（沙箱内无同源、无网络，仍安全；
                // 文档自身 CSP 的 form-action 'none' 兜底禁止一切导航）
                sandbox="allow-scripts allow-forms"
                src={doc}
                style={{ height }}
              />
            )}
            {errors.length > 0 ? (
              <div className="ui-html-errors" role="alert">
                <div className="ui-html-errors-title">
                  <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />
                  <span>脚本错误（键盘操作需先点击画面获取焦点）</span>
                </div>
                {errors.map((text, index) => (
                  <div key={`${index}-${text.slice(0, 24)}`} className="ui-html-error-line">
                    {text}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
