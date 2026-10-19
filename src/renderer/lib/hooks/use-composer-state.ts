import { useState, type KeyboardEvent } from 'react';

export function useComposerState() {
  const [input, setInput] = useState('');

  function handleInputChange(value: string) {
    setInput(value);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, isRunning: boolean) {
    // 输入法候选窗打开时的 Enter 是"确认候选字"，不能当成发送
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }

    if (event.key !== 'Enter' || event.shiftKey || isRunning) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return {
    input,
    setInput,
    handleInputChange,
    handleComposerKeyDown,
  };
}
