# System to User Spec

Version: `1.0.0`.

`README.md` covers usage. This file defines the event contract, modification rules, and compatibility details.

## Public surface

| Capability | Detail |
|---|---|
| Event | `before_provider_request` — rewrites system role to user role in the outgoing payload |

## Event contract

### Payload shape (from Oh My Pi)

```ts
{
  payload: {
    model?: string;
    input?: Array<{ role: string; content: string } | { type: string; call_id: string; name: string; arguments: string }>;
    messages?: Array<{ role: string; content: string }>;
    [key: string]: unknown;
  }
}
```

### Modification rules

| Condition | Behavior |
|---|---|
| `payload` is falsy | Return `undefined` (no-op) |
| `payload.input` is not an array | Return `undefined` (no-op) |
| Input has item(s) with `role === 'system'` | Each such item is shallow-copied with `role` set to `'user'`; function_call items are left untouched |
| At least one system role was converted | Return the modified payload |
| No system role found | Return `undefined` |

## Error handling

| Scenario | Behavior |
|---|---|
| Missing or null payload | Returns `undefined` |
| No `input` array (e.g. `messages`-only payload) | Returns `undefined` |
| Non-system roles (`user`, `developer`, etc.) | Preserved as-is |
| Mixed system + non-system items | Only system items are converted; order is preserved |
| Payload with extra fields | All fields (`model`, `temperature`, `stream` etc.) are preserved verbatim |

## Compatibility

- Targets the `before_provider_request` event introduced by Oh My Pi's provider abstraction layer.
- Does **not** modify `messages`-based payloads (the older completion-style API path).
- Function call entries (`{ type: 'function_call', ... }`) are never modified regardless of position.
- Safe to enable alongside other `before_provider_request` handlers; each handler receives the same event independently.

## Full-suite compatibility

- No dependencies.
- No configuration files or environment variables.
- No tool or command registration — purely event-driven.
- Forked sessions and subagents inherit the extension automatically.

## Dependencies

None.

## Test

```bash
bun test
```
