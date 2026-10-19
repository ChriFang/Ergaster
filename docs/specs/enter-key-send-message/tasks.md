# Enter key send message task plan
- [x] Task 1: Add keyboard submit support to the chat composer
    - 1.1: Add a textarea keydown handler for Enter and Shift+Enter
    - 1.2: Route plain Enter through the existing form submit flow
    - 1.3: Preserve multiline editing with Shift+Enter and keep button submit unchanged

- [x] Task 2: Verify submit behavior remains correct
    - 2.1: Confirm empty input and running-state protections still work
    - 2.2: Run type checking and resolve any issues introduced by the keyboard handler
