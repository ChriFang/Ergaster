# Split status and chat window

## Requirement scenario and processing logic
- The current desktop UI renders the status area and the chat area inside the same page layout, but the chat conversation growth currently pushes the whole page scroll.
- When the conversation becomes long and the user scrolls downward, the status area also moves with the page, which makes the status information hard to keep visible.
- The expected behavior is to separate the status window and the chat window at the scrolling level:
  - the status window remains visually fixed in its own area
  - the chat window scrolls independently when messages increase
  - the input area remains usable without the status window moving together with chat history
- The existing content, message rendering, settings panel, confirmation panel, and execution status behavior must remain unchanged.

## Architecture and technical approach
- Keep the existing two-column layout in `App.tsx`, because the current DOM structure already separates sidebar and chat panel logically.
- Fix the viewport layout at the shell level so the application itself occupies the window height instead of allowing the entire page to grow with chat history.
- Constrain the chat region height and move vertical scrolling into the chat content area rather than the full page.
- Use one of these two implementation patterns, preferring the simpler CSS-first option if it fully satisfies the behavior:
  1. CSS-only separation
     - make `.app-shell` consume the viewport height and hide outer overflow
     - let `.sidebar` keep its own height and optional own overflow
     - let `.chat-panel` have constrained height with `min-height: 0`
     - make `.message-list` the scroll container with `overflow-y: auto`
  2. Small structure adjustment if needed
     - add a wrapper in `App.tsx` around the scrollable chat content above the composer
     - keep the composer outside the scrollable region so the input area stays pinned at the bottom of the chat panel
- Prefer the second pattern if the first pattern causes settings, activity, or confirmation blocks to compete with message scrolling.

## Affected files
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - Possible small layout adjustment to split fixed and scrollable regions in the chat panel
  - Affected render section: `App` component around `chat-panel`, `message-list`, and `composer`
- `e:\other-code\desktop-tools\src\renderer\styles.css`
  - Update shell, sidebar, chat panel, and message list sizing/overflow rules
  - Main selectors likely affected: `.app-shell`, `.sidebar`, `.chat-panel`, `.message-list`, and possibly a new wrapper such as `.chat-scroll-area`

## Implementation details
- Current structure already separates status and chat in two columns:
```tsx
<div className="app-shell">
  <aside className="sidebar">...</aside>
  <main className="chat-panel">...</main>
</div>
```
- Recommended sizing and overflow direction:
```css
.app-shell {
  height: 100vh;
  overflow: hidden;
}

.sidebar,
.chat-panel {
  min-height: 0;
}

.chat-panel {
  height: 100vh;
  overflow: hidden;
}

.message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
```
- If the composer should stay fixed at the bottom while the upper content scrolls, introduce a wrapper like:
```tsx

<main className="chat-panel">
  <header className="chat-header">...</header>
  <div className="chat-scroll-area">
    {isRunning ? <section className="activity-panel">...</section> : null}
    {confirmationRequest ? <section className="confirm-panel">...</section> : null}
    {showSettings ? <section className="settings-panel">...</section> : null}
    <section className="message-list">...</section>
  </div>
  <form className="composer">...</form>
</main>
```
```css
.chat-scroll-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
```
- This keeps the status area outside the chat scroll path and makes the chat panel manage its own overflow.

## Boundary conditions and exception handling
- Long conversations must scroll only inside the chat area, not at the document/page level.
- The status sidebar must remain visible even when the message list becomes very long.
- If settings or confirmation panels are open, the layout must still avoid pushing the full window into page scroll.
- On narrow screens where the layout collapses to a single column, the scrolling behavior should remain usable and should not create double-scroll traps.
- Message cards with long content must still wrap correctly and remain readable.

## Data flow paths
- User sends messages through the existing composer.
- New messages append to the existing `messages` state in `App.tsx`.
- The rendered message history grows inside `message-list`.
- Instead of expanding overall page height, the chat area consumes its own scroll space.
- The status sidebar remains in its own non-chat scroll context.

## Expected outcomes
- Scrolling a long conversation no longer drags the status window with it.
- The status window and chat window behave as separate visual regions.
- The chat history remains scrollable and the input remains accessible.
- Existing status cards, settings, confirmation UI, and message rendering behavior remain intact.
