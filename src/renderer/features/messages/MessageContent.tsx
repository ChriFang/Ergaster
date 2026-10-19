import { memo, type MouseEvent as ReactMouseEvent } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MessageBodyModel } from './message-model';
import { messageUrlTransform, toLocalFilePath } from './message-link';

type MessageContentProps = {
  body: MessageBodyModel;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  className?: string;
};

/**
 * 插件数组与 components 映射必须是模块级常量。
 * 写成内联字面量会让 react-markdown 每次渲染都重建处理器并全量重解析 markdown，
 * 50 条消息的会话切换实测因此多花数百毫秒。
 */
const REMARK_PLUGINS = [remarkGfm];

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children, ...props }) => {
    const url = typeof href === 'string' ? href : '';
    const localFilePath = toLocalFilePath(url);

    return (
      <a
        {...props}
        href={url}
        target="_blank"
        rel="noreferrer"
        title={localFilePath || undefined}
        onClick={(event) => {
          event.preventDefault();
          if (!url) {
            return;
          }

          const openTask = localFilePath
            ? window.desktopApp.openPath(localFilePath)
            : window.desktopApp.openExternalLink(url);

          void Promise.resolve(openTask).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`打开链接失败：${localFilePath || url}`, message);
          });
        }}
      >
        {children}
      </a>
    );
  },
};

export const MessageContent = memo(function MessageContent({ body, onContextMenu, className = '' }: MessageContentProps) {
  const contentClassName = `message-content ${className}`.trim();

  if (body.kind === 'markdown') {
    return (
      <div className={`${contentClassName} message-markdown`} onContextMenu={onContextMenu}>
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          urlTransform={messageUrlTransform}
          components={MARKDOWN_COMPONENTS}
        >
          {body.text}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <pre className={`${contentClassName} message-content-prewrap`} onContextMenu={onContextMenu}>
      {body.text}
    </pre>
  );
});
