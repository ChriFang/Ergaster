# Enter key send message

## Requirement scenario and processing logic
- In the chat composer, users currently need to click the "发送" button to submit a message.
- The expected behavior is that pressing `Enter` sends the current message directly.
- Because the composer uses a `textarea`, the implementation must define multiline behavior clearly. The recommended behavior is:
  - `Enter` sends the message
  - `Shift+Enter` inserts a newline
- Empty or whitespace-only content should still be blocked by the existing validation.
- The shortcut must respect the current running state and should not trigger when sending is disabled.

## Architecture and technical approach
- Keep the existing form submit handler `handleRunAgent` as the single submit path.
- Add a keyboard handler on the chat `textarea` in `src/renderer/App.tsx`.
- On `Enter` without `Shift`, prevent the default newline behavior and submit through the existing form flow.
- On `Shift+Enter`, preserve normal textarea multiline input.
- Avoid duplicating send logic in the keyboard handler; reuse the existing submit pipeline.

## Affected files
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - Add a textarea keyboard handler for `Enter` / `Shift+Enter`
  - Reuse the existing `handleRunAgent` submit flow
  - Keep current button submit behavior unchanged

## Implementation details
- Add a keyboard event handler similar to:
```ts
function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== 'Enter' || event.shiftKey || isRunning) {
    return;
  }

  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}
```
- Attach it to the textarea:
```tsx
onKeyDown={handleComposerKeyDown}
```
- Continue to use `handleRunAgent` for validation, optimistic message append, status updates, and send execution.

## Boundary conditions and exception handling
- `Shift+Enter` must still produce a newline.
- Plain `Enter` must not insert a newline when it triggers send.
- While `isRunning` is true, keyboard submit must not trigger.
- Empty input must still show the existing validation message and must not send.
- Button submit must continue working exactly as before.

## Data flow paths
- User types in the controlled textarea.
- User presses `Enter`.
- Key handler intercepts non-shift Enter and requests form submission.
- Existing `handleRunAgent` validates the message and runs the send pipeline.
- If the user presses `Shift+Enter`, textarea keeps its multiline editing behavior.

## Expected outcomes
- Pressing `Enter` sends the message.
- Pressing `Shift+Enter` inserts a newline.
- The send button still works.
- Existing validation, clear-after-send behavior, and running-state protections remain unchanged.
