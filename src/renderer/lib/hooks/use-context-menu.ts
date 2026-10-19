import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import type { ContextMenuState } from '../types/app-shell';
import { desktopAppClient } from '../desktop/desktop-app-client';

export function useContextMenu(
  chatScrollAreaRef: RefObject<HTMLDivElement | null>,
  setRunStatus: (message: string) => void,
  onResetConversation: () => Promise<void>,
) {
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    function handlePointerDown() {
      setContextMenuState(null);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setContextMenuState(null);
      }
    }

    const container = chatScrollAreaRef.current;
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    container?.addEventListener('scroll', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      container?.removeEventListener('scroll', handlePointerDown);
    };
  }, [chatScrollAreaRef, contextMenuState]);

  const copyText = useCallback(async (text: string, successMessage: string) => {
    const normalized = text.trim();
    if (!normalized) {
      setRunStatus('没有可复制的内容。');
      return;
    }

    try {
      await desktopAppClient.copyText(normalized);
      setRunStatus(successMessage);
    } catch {
      setRunStatus('复制失败，请重试。');
    }
  }, [setRunStatus]);

  async function handleCopySelection() {
    if (!contextMenuState || contextMenuState.type !== 'message-selection' || !contextMenuState.selectedText) {
      return;
    }

    await copyText(contextMenuState.selectedText, '已复制选中内容。');
    setContextMenuState(null);
  }

  async function handleResetConversation() {
    await onResetConversation();
    setContextMenuState(null);
  }

  const handleMessageContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const selectedText = window.getSelection()?.toString().trim() ?? '';
    if (!selectedText) {
      setContextMenuState(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setContextMenuState({
      x: event.clientX,
      y: event.clientY,
      type: 'message-selection',
      selectedText,
    });
  }, []);

  function handleConversationBlankContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const selectedText = window.getSelection()?.toString().trim() ?? '';

    if (selectedText) {
      setContextMenuState(null);
      return;
    }

    if (target.closest('.message-card-shell') || target.closest('.message-context-menu')) {
      return;
    }

    event.preventDefault();
    setContextMenuState({
      x: event.clientX,
      y: event.clientY,
      type: 'conversation-blank',
    });
  }

  return {
    contextMenuState,
    setContextMenuState,
    copyText,
    handleCopySelection,
    handleMessageContextMenu,
    handleConversationBlankContextMenu,
    handleResetConversation,
  };
}
