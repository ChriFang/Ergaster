import type { ContextMenuState } from '../../lib/types/app-shell';

type MessageContextMenuProps = {
  state: ContextMenuState;
  onCopy: () => void;
  onResetConversation: () => void;
};

export function MessageContextMenu({ state, onCopy, onResetConversation }: MessageContextMenuProps) {
  return (
    <div className="message-context-menu" style={{ top: state.y, left: state.x }} onPointerDown={(event) => event.stopPropagation()}>
      {state.type === 'message-selection' ? (
        <button className="message-context-menu-item" type="button" onClick={onCopy}>
          复制
        </button>
      ) : (
        <button className="message-context-menu-item" type="button" onClick={onResetConversation}>
          重置会话
        </button>
      )}
    </div>
  );
}
