# Remove default chat input

## Requirement scenario and processing logic
- After the program initializes, the chat input box currently shows the default text `帮我打开记事本`.
- The expected behavior is that the composer starts empty, so users see a blank input field and only the placeholder guidance text.
- This change should affect only the initial value of the controlled input state and must not alter later input, submit, reset, or placeholder behavior.

## Architecture and technical approach
- The renderer chat composer in `src/renderer/App.tsx` owns the controlled input state.
- The fix is to change the initial React state for the message draft from the hardcoded sample text to an empty string.
- No IPC, persistence, or agent-service changes are needed because this is a renderer-only initial state adjustment.

## Affected files
- `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - Update the initial `useState` value for the chat input.
  - No other functional changes expected.

## Implementation details
- Replace:
```ts
const [input, setInput] = useState('帮我打开记事本');
```
- With:
```ts
const [input, setInput] = useState('');
```
- Keep the existing placeholder text:
```tsx
placeholder="输入你的桌面操作指令..."
```
so the UI still provides guidance without prefilled content.

## Boundary conditions and exception handling
- The change must not affect the validation that blocks empty submissions.
- The change must not affect the existing behavior that clears input after valid submission.
- The change must not affect historical messages, reset behavior, or initial assistant tips in the message list.

## Data flow paths
- App initializes.
- Renderer composer state is created.
- Input field reads the controlled state value.
- With an empty initial state, the input renders blank and shows the placeholder until the user types.

## Expected outcomes
- On startup, the input field is empty.
- Users only see the placeholder guidance text before typing.
- Sending, clearing, and validation behavior remain unchanged.
