# Tool confirmation bottom card

## Requirement scenario and processing logic
- The current external-tool confirmation card is rendered inside the scrollable chat content before the message list, so its visual position depends on the current scroll offset and the total message height.
- When the agent requests confirmation for a medium/high-risk external tool call, the confirmation UI should appear at the bottom of the conversation area every time, adjacent to the latest chat context, instead of being inserted above the message list.
- The expected behavior is:
  - the latest conversation content remains visible;
  - the confirmation card is shown at the bottom of the dialog area whenever `confirmationRequest` exists;
  - when the user confirms or rejects, the card disappears without breaking the existing tool confirmation IPC flow.
- This improvement should coexist with the existing auto-scroll behavior for latest messages and should not change the main-process confirmation contract.

## Architecture and technical approach
- Keep the tool confirmation request lifecycle unchanged in the main process and preload bridge:
  - `src/main/tool-registry.ts` still requests confirmation before executing risky tools;
  - `src/main/confirmation-service.ts` still sends `tool:confirm` and waits for the response;
  - `src/preload/index.ts` still exposes the subscription and response APIs.
- Adjust the renderer layout in `src/renderer/App.tsx` so the confirmation card is no longer part of the scrollable message content.
- Render the confirmation card between the scrollable chat area and the bottom composer. This keeps it visually at the bottom of the dialog area while separating it from both the message list and the input card.
- Keep the existing auto-scroll behavior focused on the scrollable conversation content. Since the confirmation card will sit outside `chat-scroll-area`, it no longer depends on scroll-container padding hacks to remain visible.
- Remove the fixed bottom-spacing workaround in CSS because a hard-coded padding value cannot robustly match the dynamic composer height.

## Affected files
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - Move the `confirm-panel` render block out of `chat-scroll-area`
  - Render the confirmation card after the scrollable conversation area and before the `composer`
  - Preserve existing handlers such as `handleToolConfirmation`, `handleRunAgent`, `handleCancelAgent`, and `handleResetAgent`
  - Keep the existing message auto-scroll behavior for conversation content
- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - Remove the fixed bottom-spacing workaround from `chat-scroll-area`
  - Add only minimal spacing adjustments if needed so the confirmation card and composer remain visually separated without overlap
- `e:\other-code\desktop-tools\src\main\confirmation-service.ts`
  - No code change expected; file is included as confirmed dependency context for the unchanged confirmation flow
- `e:\other-code\desktop-tools\src\main\tool-registry.ts`
  - No code change expected; file is included as confirmed dependency context for the unchanged confirmation trigger path
- `e:\other-code\desktop-tools\src\preload\index.ts`
  - No code change expected; file is included as confirmed dependency context for the unchanged renderer bridge

## Implementation details
- Keep the existing subscription logic that sets `confirmationRequest`:
```ts
const unsubscribe = window.desktopApp.onToolConfirmationRequested((request) => {
  setConfirmationRequest(request);
  setRunStatus(`等待确认：${request.summary}`);
});
```
- Keep the scrollable message area focused on conversation content only:
```tsx
<div className="chat-scroll-area" ref={chatScrollAreaRef}>
  {isRunning ? <section className="activity-panel">...</section> : null}
  {showSettings ? <section className="settings-panel">...</section> : null}
  <section className="message-list">...</section>
</div>
```
- Render the confirmation card below the scroll area and above the composer:
```tsx
{confirmationRequest ? (
  <section className="confirm-panel">
    ...
  </section>
) : null}

<form className="composer">...</form>
```
- Preserve the existing message auto-scroll effect for conversation content. It can continue reacting to `visibleMessages` and confirmation visibility if needed for run-state transitions, but the confirmation card itself must no longer depend on scroll positioning to remain clickable.
- Remove the fixed `padding-bottom` / `scroll-padding-bottom` workaround from `.chat-scroll-area`, because the composer height is dynamic and cannot be reliably matched by a hard-coded value.
- Preserve the existing confirm/reject button handlers and IPC response logic; only the visual placement and container ownership of the confirmation card change.

## Boundary conditions and exception handling
- When there are no conversation messages yet and only the default assistant messages are shown, the confirmation card should still appear at the bottom of the visible conversation area.
- When a user has manually scrolled upward and a confirmation request arrives, the UI should keep the latest conversation content available without requiring the confirmation card to become part of the scrollable message stack.
- When confirmation is cleared by approve, reject, reset, cancel, or request completion, the message list layout should remain stable.
- Low-risk tools must continue to bypass the confirmation card because that behavior is controlled in `src/main/confirmation-service.ts`.
- The change must not interfere with the settings panel, activity panel, right-click copy menu, or composer area.
- The confirmation card must remain fully visible and clickable and must not be covered by the composer, regardless of composer height changes caused by resizing, wrapping, or responsive layout.
- The confirmation card must not overlap any other conversation card; messages remain inside the scroll area, while the confirmation card occupies its own separate block above the composer.

## Data flow paths
- A risky tool call is requested in `src/main/tool-registry.ts`.
- `requestToolConfirmation` in `src/main/confirmation-service.ts` emits `tool:confirm` to the renderer.
- `window.desktopApp.onToolConfirmationRequested` in `src/preload/index.ts` forwards the payload to `src/renderer/App.tsx`.
- `App.tsx` updates `confirmationRequest`, re-renders the bottom confirmation card, and scrolls `chat-scroll-area` to its bottom.
- The user chooses approve or reject.
- `handleToolConfirmation` sends the response back through preload to the main process, and the card is removed.

## Expected outcomes
- Every medium/high-risk external-tool confirmation card is shown at the bottom of the conversation area.
- The confirmation card is automatically brought into view even when no new message is appended at the same moment.
- Existing tool execution, cancellation, reset, status display, and message rendering behavior remain unchanged.
- No main-process or preload behavior changes are required for this UI improvement.
