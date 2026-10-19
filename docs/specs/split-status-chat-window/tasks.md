# Split status and chat window task plan
- [x] Task 1: Separate chat scrolling from the overall page layout
    - 1.1: Review the current `app-shell`, `sidebar`, `chat-panel`, and `message-list` sizing relationship in `src/renderer/App.tsx` and `src/renderer/styles.css`
    - 1.2: Adjust the shell and panel height constraints so the app uses the viewport height instead of growing the whole page
    - 1.3: Move vertical overflow handling into the chat region so the status sidebar no longer scrolls together with chat history

- [x] Task 2: Keep the composer and upper chat sections usable after the layout split
    - 2.1: If needed, add a dedicated scroll wrapper in `src/renderer/App.tsx` for activity, confirmation, settings, and message content
    - 2.2: Update related styles in `src/renderer/styles.css` so the composer remains accessible and the chat content scrolls independently
    - 2.3: Preserve the existing sidebar content, message rendering, and narrow-screen layout behavior

- [x] Task 3: Verify the new layout behavior is stable
    - 3.1: Check that long chat history scrolls only inside the chat area and does not move the status sidebar
    - 3.2: Run type checking to confirm the layout update does not introduce renderer errors
