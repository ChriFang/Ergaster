# Split status and chat window summary

## Completed work
- Kept the existing two-column desktop layout and changed the renderer to use the viewport as the fixed outer boundary.
- Added a dedicated `chat-scroll-area` wrapper in `src/renderer/App.tsx` so the chat header and composer are separated from the scrollable chat content.
- Updated `src/renderer/styles.css` so `html`, `body`, `#root`, `.app-shell`, `.sidebar`, and `.chat-panel` no longer allow the whole page to grow with chat history.
- Moved vertical scrolling into the chat area while allowing the sidebar to keep its own independent overflow behavior.
- Preserved the existing status cards, settings panel, activity panel, confirmation panel, message rendering, and composer behavior.
- Adjusted the narrow-screen media rule so the single-column layout remains usable after the fixed-height changes.

## Verification results
- `npm run typecheck` passed successfully.
- The resulting layout now keeps the status sidebar out of the chat scroll path by constraining the shell and making the chat content scroll independently.

## Affected files
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
- `e:\other-code\desktop-tools\src\renderer\styles.css`
- `e:\other-code\desktop-tools\.comate\specs\split-status-chat-window\tasks.md`

## Notes
- The implementation chose the small-structure-adjustment approach because it keeps the composer pinned outside the scroll container and avoids the settings/activity/confirmation sections forcing page-level scrolling.
