# Oh Rpiv Advisor Spec

Version: `1.0.0`.

`README.md` covers usage. This file defines the bridge contract, API mapping, and compatibility rules.

## Public surface

| Capability | Detail |
|---|---|
| Tool | `advisor` — escalate to stronger reviewer model |
| Command | `/advisor` — same escalation via slash command |
| Internal | Patches `ModelRegistry.prototype.getApiKeyAndHeaders` if missing |

## Bridge contract

The bridge maps oh-my-pi's `ExtensionAPI` to the `@mariozechner/pi-coding-agent` API that rpiv-advisor requires at runtime.

### Registration

| oh-my-pi | rpiv-advisor target |
|---|---|
| `pi.registerTool(toolDef)` | `.registerTool(toolDef)` |
| `pi.registerCommand(name, opts)` | `.registerCommand(name, opts)` |

### Events

| oh-my-pi event | rpiv-advisor target | Notes |
|---|---|---|
| `pi.on(event, handler)` | `.on(event, handler)` | Passthrough for all events; `model_select` dropped |

### Messaging

| oh-my-pi | rpiv-advisor target |
|---|---|
| `pi.sendMessage(msg, opts)` | `.sendMessage(msg, opts)` |
| `pi.sendUserMessage(content, opts)` | `.sendUserMessage(content, opts)` |
| `pi.appendEntry(customType, data)` | `.appendEntry(customType, data)` |

### Model / Session

| oh-my-pi | rpiv-advisor target |
|---|---|
| `pi.setModel(model)` | `.setModel(model)` (returns Promise) |
| `pi.getSessionName()` | `.getSessionName()` |
| `pi.setSessionName(name)` | `.setSessionName(name)` (returns Promise) |
| `pi.getThinkingLevel()` | `.getThinkingLevel()` |
| `pi.setThinkingLevel(level)` | `.setThinkingLevel(level)` |

### Tools

| oh-my-pi | rpiv-advisor target |
|---|---|
| `pi.getActiveTools()` | `.getActiveTools()` |
| `pi.getAllTools()` | `.getAllTools()` |
| `pi.setActiveTools(names)` | `.setActiveTools(names)` (returns Promise) |

### Label

| oh-my-pi | rpiv-advisor target |
|---|---|
| `pi.setLabel(label)` | `.setLabel(label)` |

### Module access

The bridge exposes a `pi` property that returns the full `@oh-my-pi/pi-coding-agent` module, required by rpiv-advisor for `pi.pi.convertToLlm()`.

## ModelRegistry patch

If `ModelRegistry.prototype.getApiKeyAndHeaders` is not defined, the extension adds it:

```ts
async function getApiKeyAndHeaders(model) {
  const apiKey = await this.getApiKey(model);
  if (!apiKey) return { ok: false, error: `No API key for ${model.provider}` };
  return { ok: true, apiKey, headers: { Authorization: `Bearer ${apiKey}` } };
}
```

## Error handling

| Scenario | Behavior |
|---|---|
| rpiv-advisor package not found | Import error propagates — verify `bun install` |
| `model_select` event emitted | Silently dropped (no-op) |
| Model registry missing `getApiKeyAndHeaders` | Patched in at extension load |
| `registerTool` throws (transient) | Error propagates; caller should retry |

## Full-suite compatibility

- Shim packages at `shim-packages/` provide stub/mock implementations for `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, and `typebox`.
- Tool/command registration is idempotent (guarded by WeakSet on the bridge's `pi` reference).
- The `pi.pi` module reference is lazily resolved and cached.
- All external imports use `file://` paths (AGENTS.md pattern) instead of bare package specifiers.

## Dependencies

- `@juicesharp/rpiv-advisor` (^1.1.5) — the advisor engine.
- `@sinclair/typebox` (^0.34.0) — type schema.
- Shim packages (local): `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `typebox`.

## Test

```bash
bun test
```
