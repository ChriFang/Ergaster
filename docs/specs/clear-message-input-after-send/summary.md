# Clear message input after send summary

## Completed work
- Updated the renderer submit handler so valid messages are copied into a local `prompt` variable before the request starts.
- Cleared the controlled input state immediately after non-empty validation passes.
- Kept the existing send pipeline unchanged by continuing to use the preserved `prompt` value for optimistic UI updates and the agent request.
- Verified the project still passes TypeScript type checking.

## Modified files
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
- `e:\other-code\desktop-tools\.comate\specs\clear-message-input-after-send\tasks.md`

## Result
- Clicking the "发送" button now clears the editor for valid messages.
- Empty or whitespace-only submissions still do not clear the editor and still show the existing validation message.
- The sent message content remains correct in chat history and downstream agent execution.
