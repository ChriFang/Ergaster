import { FileText, FolderOpen, Image as ImageIcon } from 'lucide-react';
import type { FilePreviewItem } from '../../lib/hooks/use-chat-session';

type FilePreviewCardProps = {
  item: FilePreviewItem;
  /** 图片点击放大：复用 MessageList 的图片预览弹窗。 */
  onOpenImage: (src: string, name: string) => void;
};

const kindLabel = { image: 'IMG', text: 'TXT', docx: 'DOC' } as const;

/** 会话区瞬时文件预览卡片：由 preview_* 工具推送，不进消息历史。 */
export function FilePreviewCard({ item, onOpenImage }: FilePreviewCardProps) {
  return (
    <article className="message message-assistant file-preview-card">
      <div className="message-row">
        <div className="message-avatar message-avatar-tool" aria-hidden="true">
          {item.kind === 'image' ? <ImageIcon size={16} strokeWidth={2} /> : <FileText size={16} strokeWidth={2} />}
        </div>
        <div className="message-stack file-preview-stack">
          <div className="message-card-shell file-preview-shell">
            <div className="file-preview-header">
              <span className="message-attachment-kind">{kindLabel[item.kind]}</span>
              <span className="file-preview-title">{item.fileName}</span>
              {/* MCP 工具结果图片没有落盘路径（path 为空），只展示不提供"打开目录" */}
              {item.path ? (
                <button
                  type="button"
                  className="file-preview-open"
                  onClick={() => {
                    void window.desktopApp.revealPathInFolder(item.path);
                  }}
                  title={item.path}
                >
                  <FolderOpen size={13} strokeWidth={2} />
                  打开目录
                </button>
              ) : null}
            </div>

            {item.kind === 'image' && item.dataUrl ? (
              <button
                type="button"
                className="file-preview-image"
                onClick={() => onOpenImage(item.dataUrl ?? '', item.fileName)}
                title="点击查看大图"
              >
                <img src={item.dataUrl} alt={item.fileName} />
              </button>
            ) : null}

            {item.kind === 'text' && item.text ? (
              <pre className="file-preview-text">{item.text}</pre>
            ) : null}

            {item.kind === 'docx' && item.html ? (
              // sandbox 置空禁用脚本/同源，mammoth 转出的 HTML 只做静态展示
              <iframe className="file-preview-docx" sandbox="" srcDoc={item.html} title={item.fileName} />
            ) : null}

            {item.truncated ? <div className="file-preview-truncated">内容过长已截断，完整内容请点"打开目录"用本地应用查看。</div> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

