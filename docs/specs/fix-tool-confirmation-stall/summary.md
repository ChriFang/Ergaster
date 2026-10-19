# Fix tool confirmation stall summary

## Completed work
- Hardened the main-process confirmation service so pending confirmation requests now track timeout metadata and summary context.
- Added confirmation lifecycle logs for request dispatch, response resolution, timeout, and cancellation.
- Replaced the previous unbounded wait with a 15-second confirmation timeout that rejects with `工具确认超时。` instead of hanging indefinitely.
- Added stronger BrowserWindow/webContents readiness checks before sending confirmation events.
- Ensured pending confirmation state is cleared consistently on response, timeout, send failure, and cancellation.
- Verified the project still passes TypeScript type checking.

## Modified files
- `e:\other-code\desktop-tools\src\main\confirmation-service.ts`
- `e:\other-code\desktop-tools\.comate\specs\fix-tool-confirmation-stall\tasks.md`

## Result
- Medium/high risk tools such as `open_application` no longer wait forever if confirmation delivery or response fails.
- Main-process logs now show whether confirmation was requested, resolved, timed out, or cancelled.
- Stale pending confirmation state is cleaned up so later tool calls are not blocked by an earlier stalled confirmation.
