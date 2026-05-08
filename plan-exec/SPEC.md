# Plan & Execute Spec

Version: `5.1.0`.

`README.md` covers usage. This file defines the API contract, error handling, and compatibility rules.

## Public surface

| Capability | Names                                        |
| ---------- | -------------------------------------------- |
| Tools      | `plan_exec`                                  |
| Hooks      | `session_start`, `input`, `session_shutdown` |

## API contract

### plan_exec tool

- **Parameters**: `{ code: string }`
    - `code`: An async function named `main` that receives `task` as its only parameter.
- **Behavior**: Runs the provided JS in a sandboxed `AsyncFunction`. Injects `task(prompt, schema?)` which spawns a child agent session.
- **Tool output**: Formatted text with execution duration and result preview (truncated at 800 chars).
- **Tool details**: `{ result, durationMs }` on success; `{ error, durationMs }` on failure.

### task() primitive

- **Signature**: `async task(prompt: string, schema?: JSONSchema): Promise<unknown>`
- **Fork**: Creates a child LLM session via `pi.pi.createAgentSession`.
- **Return tool**: Dynamically generated per fork, bound to the provided schema.
- **Inheritance**: Child inherits parent `modelRegistry`, `model`, `thinkingLevel`, `hasUI`, `providerSessionId`, `systemPrompt`, and active `toolNames`.

## Error handling

| Scenario                      | Behavior                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `code` does not define `main` | Throws `The provided code must define an async function named "main".`               |
| `pi-coding-agent` unavailable | Throws `plan_exec requires @oh-my-pi/pi-coding-agent but it is not available`        |
| Child never calls `return`    | Rejects after 20 empty turns with `Task fork exited 20 times without calling return` |
| Parent session aborted        | Rejects with `Parent session aborted`                                                |
| Runtime exception in `main`   | Returns error result with message and `isError: true`                                |

## Fork lifecycle

1. Child session created via `createAgentSession(options)`.
2. UI events bridged through `TurnOutputGate` to serialize output to the main session.
3. Child prompted with the task description.
4. Child must call `return(result)`; otherwise a corrective prompt is injected up to `MAX_EMPTY_TURNS` (20).
5. On completion or failure: abort child, unsubscribe UI gate, remove from active fork registry, destroy session.

## Input steering

- `input` hook intercepts user messages when forks are running.
- Messages are forwarded to all running forks via `session.steer(text)` (if streaming) or `session.prompt(text)`.
- Returns `{ action: 'handled' }` to prevent further processing.

## Session shutdown

- `session_shutdown` hook aborts all active forks for the ending session.

## Full-suite compatibility

- Idempotent registration (WeakSet guard).
- Forked sessions and subagents inherit the extension through Oh My Pi's extension discovery.
- No file-system persistence; all state is in-memory.

## Dependencies

- `@sinclair/typebox` (for tool parameter schema; falls back to plain objects if unavailable)
- No other npm dependencies.
- Extension does **not** install oh-my-pi packages directly; it accesses `pi.pi.createAgentSession` at runtime.

## Test

```bash
npm test
```
