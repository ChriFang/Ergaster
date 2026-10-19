# Fix tool confirmation stall

## Requirement scenario and processing logic
- When the model requests `open_application` for a medium-risk action such as opening Calculator, the log currently stops after `Tool call requested: open_application ...` and no later `Tool execution started` or `Tool execution finished` line appears.
- The current execution path in `e:\other-code\desktop-tools\src\main\tool-registry.ts` waits for `requestToolConfirmation(...)` before logging tool execution start.
- If the confirmation request is not delivered to the renderer, or the renderer never responds, the Promise in `requestToolConfirmation` waits indefinitely and the whole tool call appears stuck.
- The required behavior is to prevent indefinite hangs, make the confirmation stage observable in logs, and fail or cancel cleanly when confirmation cannot be completed.

## Architecture and technical approach
- Keep the existing medium/high risk confirmation model.
- Strengthen the confirmation service instead of bypassing confirmation for `open_application`.
- Add explicit lifecycle handling around the pending confirmation Promise:
  - log when a confirmation request is sent
  - reject or resolve cleanly if no usable window exists
  - reject or resolve cleanly if the renderer does not answer within a bounded timeout
  - clear pending state on timeout / response / cancellation so later requests are not blocked
- Add logs at the main-process confirmation layer so future stalls can be distinguished between:
  - request emitted
  - response received
  - timeout reached
  - cancelled by user/system
- Preserve current renderer confirmation UI and preload bridge unless a concrete mismatch is found during execution.

## Affected files
- `e:\other-code\desktop-tools\src\main\confirmation-service.ts`
  - Add timeout handling, stronger window checks, and detailed confirmation logs.
  - Update `requestToolConfirmation()` and related pending-confirmation cleanup logic.
- `e:\other-code\desktop-tools\src\main\tool-registry.ts`
  - Keep existing execution flow, but rely on improved confirmation-service behavior so tool calls do not hang indefinitely.
  - No API contract changes expected.
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - Likely no functional change required if the renderer already listens and responds correctly.
  - Only touch if implementation verification shows a missing status update or unhandled response failure.
- `e:\other-code\desktop-tools\src\preload\index.ts`
  - Likely no functional change required unless a bridge mismatch is found.

## Implementation details
- In `requestToolConfirmation()`:
  - validate that a non-destroyed BrowserWindow and webContents are available
  - emit a log before sending the `tool:confirm` event
  - create a timeout (for example 15 seconds) for confirmation waiting
  - if timeout fires first, clear `pendingConfirmation` and reject with a descriptive error such as `工具确认超时。`
- In the IPC response handler:
  - log whether confirmation was approved or rejected
  - clear timeout and pending state before resolving
- In cancellation cleanup:
  - clear timeout before resolving pending confirmation with `false`
- Representative pattern:
```ts
let pendingConfirmation: {
  resolve: (value: boolean) => void;
  reject: (reason?: unknown) => void;
  timeoutId: NodeJS.Timeout;
} | null = null;
```
```ts
const timeoutId = setTimeout(() => {
  if (!pendingConfirmation) {
    return;
  }
  pendingConfirmation.reject(new Error('工具确认超时。'));
  pendingConfirmation = null;
}, 15000);
```
- Main-process logs should include enough information to distinguish dispatch from execution, for example:
  - `Tool confirmation requested: open_application ...`
  - `Tool confirmation resolved: approved`
  - `Tool confirmation timed out: open_application ...`

## Boundary conditions and exception handling
- If no window is available, fail immediately instead of waiting.
- If the renderer never receives or answers the confirmation request, fail after timeout instead of hanging indefinitely.
- If a second confirmation is requested while one is pending, keep the existing guard and return a clear error.
- If the user cancels the agent while waiting for confirmation, resolve the pending request consistently and clear timeout state.
- Avoid leaving stale `pendingConfirmation` state that could block future tool calls.

## Data flow paths
- Model emits tool call.
- `tool-registry.ts` validates arguments and requests confirmation.
- `confirmation-service.ts` sends `tool:confirm` to the renderer and starts a timeout.
- Renderer either:
  - responds via `tool:confirm-response`, or
  - never responds and timeout fires.
- Main process resolves/rejects confirmation request, writes logs, then either:
  - continues to tool execution, or
  - returns a tool error/cancel result.

## Expected outcomes
- Opening Calculator or other medium/high risk tools no longer hangs forever at the confirmation stage.
- Logs clearly show whether the flow is waiting for confirmation, received a response, timed out, or was cancelled.
- Failed confirmation delivery becomes an explicit error instead of a silent stall.
- Future tool calls remain usable because pending confirmation state is always cleaned up.
