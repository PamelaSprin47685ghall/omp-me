# Oh Tau Mirror Spec

Version: `1.0.0`.

`README.md` covers usage. This file defines the proxy architecture, event routing, and bridge contract.

## Public surface

| Capability | Detail |
|---|---|
| Event handlers | `session_start`, `input`, `message_start`, `turn_end`, `message_end` |
| Internal events consumed | `squad:subagent:stream` |
| HTTP proxy | Multi-session MITM proxy between browser and tau-mirror |

## Bridge contract

The bridge (`createBridge`) maps oh-my-pi's `ExtensionAPI` to the `@mariozechner/pi-coding-agent` API that tau-mirror expects.

| oh-my-pi API | tau-mirror equivalent |
|---|---|
| `pi.on(event, handler)` | `.on(event, handler)` — supported events passthrough; `model_select` dropped |
| `pi.registerCommand(name, opts)` | `.registerCommand(name, opts)` |
| `pi.sendUserMessage(content, opts)` | `.sendUserMessage(content, opts)` |
| `pi.setModel(model)` | `.setModel(model)` |
| `pi.getSessionName()` / `pi.setSessionName()` | `.getSessionName()` / `.setSessionName()` |
| `pi.getThinkingLevel()` / `pi.setThinkingLevel()` | `.getThinkingLevel()` / `.setThinkingLevel()` |

### Session file tagging

Every event object received by the bridge is tagged with `__sessionFile` for the proxy to route correctly in multi-session views.

### Catalog refresh

Only these events trigger a sidebar catalog refresh:
- `message_end`
- `turn_end`

`message_update` (streaming tokens) is explicitly excluded to avoid excessive re-renders.

### Unsupported events

`model_select` is silently dropped — it has no oh-my-pi equivalent.

## Proxy architecture

The proxy intercepts HTTP traffic between the browser and tau-mirror to:

1. **Multi-session routing**: each session gets isolated file tracking
2. **Subagent streaming**: squad worker/reviewer events forwarded to the correct browser session
3. **Session activation**: when the user speaks in a session, it becomes the active session in the browser sidebar

### Proxy port

The proxy starts on a dynamically assigned port. tau-mirror's port is captured from the `setStatus('mirror', ...)` call, then the display is rewritten to show the proxy's port.

### Subagent stream forwarding

```ts
eventBus.on('squad:subagent:stream', (data: { event: object; sessionFile: string }) => {
  proxy.forwardSubagentEvent(data.event, data.sessionFile);
});
```

## Error handling

| Scenario | Behavior |
|---|---|
| tau-mirror package not found | Import error propagates — verify `bun install` |
| Proxy port capture timeout (3s) | Falls back to tau-mirror's original port |
| `addSessionFile` called with undefined | Guarded by optional chaining |

## Full-suite compatibility

- Console methods (`log`, `warn`, `error`) are replaced with no-ops at module scope — affects entire process, intentional for TUI cleanliness.
- The `pi.on` method is temporarily wrapped during `session_start` and restored after.
- Session tracking uses process-local state (in-memory session file registry).

## Dependencies

- `tau-mirror` (^1.0.7) — the Web UI mirroring engine.

## Test

```bash
bun test
```
