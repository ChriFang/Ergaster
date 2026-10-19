# Clear message input after send

## Requirement scenario and processing logic
- In the chat interface, after the user clicks the "发送" button, the text currently remains in the editor.
- The expected behavior is that once a message has passed the local submit guard and is handed to the send flow, the input box should be cleared immediately so the editor reflects that the message has been submitted.
- Empty or whitespace-only content should still be rejected without clearing, so accidental clicks do not erase draft text normalization behavior unexpectedly.
- Keyboard submit behavior and button submit behavior must stay consistent.

## Architecture and technical approach
- The issue is expected to be in the renderer chat input state management, likely in the component that owns the textarea/input value and the submit handler.
- The fix should keep the current controlled-input pattern and move the clear action into the same submit branch that actually dispatches the send request.
- If the submit handler is async, capture the outgoing text before state reset to avoid sending an empty message after clearing.
- Do not introduce new abstractions or cross-component state unless the current implementation already requires it.

## Affected files
- Analyze and likely modify the renderer chat page component that contains the message draft state and send handler.
- Analyze and possibly modify any extracted input component only if it owns the local draft state.
- Spec target path:
  - `e:\other-code\desktop-tools\src\renderer\App.tsx` or the actual renderer input component found during implementation

## Implementation details
- Keep the input as a controlled field.
- In the submit handler:
  1. Read the current draft value.
  2. Trim/check for empty content.
  3. Preserve the original message payload in a local variable.
  4. Clear the state used by the input control.
  5. Continue the existing send flow using the preserved payload.
- Representative pattern:
```ts
const message = draft.trim();
if (!message) {
  return;
}
setDraft('');
await sendMessage(message);
```
- If the UI currently needs to keep the original spacing rather than trimmed text, use one variable for validation and another for the original payload.

## Boundary conditions and exception handling
- Do not clear the editor when the current content is empty or only whitespace.
- Do not rely on stale React state after clearing.
- If sending can fail, the default behavior for this change is still to clear after submission starts, matching common chat UX and the stated requirement.
- Avoid double-submit regressions when users click repeatedly.

## Data flow paths
- User types into controlled renderer input state.
- User clicks "发送" or triggers equivalent submit action.
- Submit handler validates the current draft.
- Valid draft is copied into a local variable.
- Renderer input state is reset to empty string.
- Existing IPC / agent request flow continues with the copied message.

## Expected outcomes
- After clicking "发送", the editor becomes empty immediately for valid messages.
- Empty messages are still blocked and the editor content is unchanged.
- The outgoing message content remains correct in chat history and downstream processing.
- Button submit and keyboard submit behave consistently.
