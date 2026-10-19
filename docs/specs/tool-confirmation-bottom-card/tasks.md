# Tool confirmation bottom card task plan
- [✓] Task 1: Reorder the confirmation card within the chat scroll area
    - 1.1: Move the `confirm-panel` render block in `src/renderer/App.tsx` so it appears after the message list inside `chat-scroll-area`
    - 1.2: Preserve the existing confirmation content, button actions, and surrounding panels while changing only the render order

- [✓] Task 2: Extend auto-scroll to include confirmation visibility changes
    - 2.1: Update the existing scroll-to-bottom effect in `src/renderer/App.tsx` so it also reacts when `confirmationRequest` becomes visible or hidden
    - 2.2: Ensure the confirmation card is scrolled into view immediately when a new risky tool confirmation arrives, even if `visibleMessages` did not change

- [✓] Task 3: Verify the renderer-only adjustment remains behaviorally safe
    - 3.1: Confirm the main-process and preload confirmation flow stays unchanged
    - 3.2: Run type checking or an equivalent project verification command to ensure the renderer update introduces no errors
    - 3.3: Keep existing chat behaviors intact, including latest-message display, reset/cancel handling, settings panel rendering, and message copy interactions

- [✓] Task 4: Reserve bottom space so the confirmation card stays clickable
    - 4.1: Update `src/renderer/styles.css` to add bottom spacing on `chat-scroll-area` so the last scroll item can move fully above the composer
    - 4.2: Keep the confirmation card at the bottom of the chat content without using z-index layering hacks
    - 4.3: Verify the composer no longer covers the confirmation card and other bottom content remains scrollable

- [x] Task 5: Move the confirmation card out of the scrollable conversation area
    - 5.1: Update `src/renderer/App.tsx` so `confirm-panel` is rendered after `chat-scroll-area` and before the `composer`
    - 5.2: Keep the message list, activity panel, and settings panel inside the scrollable area without overlap from the confirmation card
    - 5.3: Remove the fixed bottom padding workaround from `src/renderer/styles.css` because the confirmation card will no longer depend on scroll-area spacing

- [x] Task 6: Verify the separated bottom layout remains stable
    - 6.1: Confirm the confirmation card remains clickable and visually separated from both the conversation cards and the composer
    - 6.2: Run type checking or equivalent verification after the layout change
    - 6.3: Ensure existing confirmation actions, auto-scroll behavior for messages, reset/cancel handling, and message copy interactions remain intact
