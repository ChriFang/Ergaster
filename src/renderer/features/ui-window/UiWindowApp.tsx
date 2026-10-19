import { useEffect, useMemo, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { UI_HTML_VERSION, type UiHtmlSpec, type UiWindowPayload } from '../../../shared/ui-form';
import { buildUiHtmlDataUrl } from '../../lib/utils/ui-html-document';
import { desktopAppClient } from '../../lib/desktop/desktop-app-client';

/** 错误面板最多展示的条数与单条长度（与内联卡片一致）。 */
const MAX_ERRORS = 4;
const MAX_ERROR_LENGTH = 240;

type BridgeMessage = {
  __agentUi?: unknown;
  widgetId?: unknown;
  nonce?: unknown;
  type?: unknown;
  data?: unknown;
  message?: unknown;
};

/**
 * 交互式 HTML widget 的独立窗口页面（由 ?uiWindow=<token> 分流进入）。
 *
 * 凭 token 向主进程认领载荷，渲染与内联同构的 sandbox iframe（data: URL + 严格 CSP + 桥接脚本），
 * 但整窗铺满、不做高度夹取。提交经 submitUiWindow 回主进程，再转发主窗口走同一条 runAgent 链路。
 */
export function UiWindowApp({ token }: { token: string }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const nonceRef = useRef<string>('');
  if (!nonceRef.current) {
    nonceRef.current = crypto.randomUUID();
  }
  const nonce = nonceRef.current;

  const [payload, setPayload] = useState<UiWindowPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const submittedRef = useRef(false);
  submittedRef.current = submitted;

  useEffect(() => {
    let cancelled = false;
    desktopAppClient
      .claimUiWindow(token)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result) {
          setLoadError('该交互组件已失效（可能主窗口已刷新或会话被清理），请关闭本窗口后在会话区重新打开。');
          return;
        }
        setPayload(result);
        document.title = result.title;
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : '加载失败。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const spec = useMemo<UiHtmlSpec | null>(
    () => (payload ? { version: UI_HTML_VERSION, widgetId: payload.widgetId, title: payload.title, html: payload.html } : null),
    [payload],
  );
  const dataUrl = useMemo(() => (spec ? buildUiHtmlDataUrl(spec, nonce) : null), [spec, nonce]);

  useEffect(() => {
    if (!payload) {
      return;
    }
    function handleMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      const msg = event.data as BridgeMessage | null;
      if (!msg || msg.__agentUi !== true || msg.nonce !== nonce || msg.widgetId !== payload!.widgetId) {
        return;
      }
      if (msg.type === 'error' && typeof msg.message === 'string') {
        const text = msg.message.slice(0, MAX_ERROR_LENGTH);
        setErrors((prev) => [...prev.slice(-(MAX_ERRORS - 1)), text]);
        return;
      }
      if (msg.type === 'submit') {
        if (submittedRef.current) {
          return;
        }
        setSubmitted(true);
        const data = msg.data && typeof msg.data === 'object' ? (msg.data as Record<string, unknown>) : {};
        void desktopAppClient.submitUiWindow({ token, data });
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [payload, nonce, token]);

  return (
    <div className="ui-window-root">
      <header className="ui-window-header">
        <span className="ui-window-title">{payload?.title ?? '交互式 HTML'}</span>
        {submitted ? <span className="ui-form-status">已提交</span> : null}
      </header>
      {loadError ? (
        <div className="ui-window-load-error" role="alert">
          {loadError}
        </div>
      ) : dataUrl ? (
        <iframe
          ref={iframeRef}
          className="ui-window-frame"
          title={payload?.title ?? '交互式 HTML'}
          // 同内联卡片：缺 allow-forms 时 <form> 的 submit 事件不触发，桥接脚本捕获不到
          sandbox="allow-scripts allow-forms"
          src={dataUrl}
        />
      ) : (
        <div className="ui-window-loading">加载中…</div>
      )}
      {errors.length > 0 ? (
        <div className="ui-window-errors" role="alert">
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
  );
}
