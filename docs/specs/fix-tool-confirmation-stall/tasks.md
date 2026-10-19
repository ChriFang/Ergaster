# Fix tool confirmation stall task plan
- [x] Task 1: Harden the main-process confirmation lifecycle
    - 1.1: Extend pending confirmation state to track timeout cleanup metadata
    - 1.2: Add window/webContents readiness checks before dispatching confirmation events
    - 1.3: Add bounded timeout handling so confirmation requests fail instead of hanging forever
    - 1.4: Clear pending state consistently on timeout, response, and cancellation

- [x] Task 2: Improve confirmation observability and validation
    - 2.1: Add main-process logs for confirmation requested, resolved, timed out, and cancelled states
    - 2.2: Verify tool execution still resumes after approval and returns a clean error after timeout
    - 2.3: Run type checking and resolve any issues introduced by the confirmation changes
