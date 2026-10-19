# Auto scroll latest message

## Requirement scenario and processing logic
- The chat message display panel currently does not automatically move to the newest message after a new conversation item is appended.
- After the user sends a new prompt, the latest message may appear below the visible area, forcing manual scrolling.
- The expected behavior is that when new conversation content is added, the chat display panel automatically scrolls to the bottom so the newest message is visible immediately.
- This behavior should work for both optimistic user messages and later assistant/tool responses that update the same conversation.
- Existing layout separation between the status area and the chat area must remain unchanged.

## Architecture and technical approach
- Reuse the current scrollable container `chat-scroll-area` in `src/renderer/App.tsx`, because it is the actual element with `overflow-y: auto`.
- Add a React ref to that scroll container.
- Add an effect that runs after the rendered message list changes and synchronizes the container scroll position to its bottom.
- Prefer a direct container scroll implementation over broader DOM querying because the renderer already owns the scroll area in the same component.
- Keep the implementation local to `App.tsx`; no preload or main-process change is required.

## Affected files
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - Add a ref for the chat scroll container
  - Add a post-render effect that scrolls to the newest message when visible messages change
  - Attach the ref to the `chat-scroll-area` element
- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - No functional style change is expected unless a small selector adjustment is needed during implementation

## Implementation details
- Add the missing React ref import and create a scroll container ref:
```ts
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

const chatScrollAreaRef = useRef<HTMLDivElement | null>(null);
```
- Attach the ref to the current scroll container:
```tsx
<div className="chat-scroll-area" ref={chatScrollAreaRef}>
```
- Add an effect to scroll to the latest rendered content:
```ts
useEffect(() => {
  const container = chatScrollAreaRef.current;
  if (!container) {
    return;
  }

  container.scrollTop = container.scrollHeight;
}, [visibleMessages]);
```
- If render timing requires a stricter post-paint sync, use `requestAnimationFrame` inside the effect, but prefer the simpler direct assignment first.

## Boundary conditions and exception handling
- The initial default assistant messages should still render correctly and should not break the effect.
- The scroll operation must be safe when the ref is not yet attached.
- Re-rendering due to status changes alone should not break the latest-message visibility behavior.
- The existing independent scrolling layout must stay intact; only the chat panel should auto-scroll.
- Resetting the conversation should remain safe even when the message list becomes empty again.

## Data flow paths
- User sends content or the app receives assistant/tool messages.
- `messages` state updates in `App.tsx`.
- `visibleMessages` recomputes and the component re-renders the chat content.
- The post-render effect runs against `chat-scroll-area` and moves the scroll position to the bottom.
- The newest message becomes visible without manual user scrolling.

## Expected outcomes
- After sending a new message, the chat panel automatically scrolls to the latest content.
- After assistant or tool messages arrive, the newest content is also brought into view.
- The status sidebar remains unaffected by the chat auto-scroll behavior.
- Existing chat layout, settings panel, and composer interactions continue working as before.
