# Block Head Tail Spec

Version: `1.0.0`.

`README.md` covers usage. This file defines the regex contract, edge case handling, and compatibility rules.

## Public surface

| Capability | Detail |
|---|---|
| Event | `tool_call` — intercepts bash commands before execution |

## Regex contract

```
/\s*\|\s*(head|tail)\s+-n\s*\d+\s*/g
```

| Component | Matches |
|---|---|
| `\s*\|` | Pipe with optional leading whitespace |
| `\s*` | Whitespace after pipe |
| `(head\|tail)` | Literal command name (lowercase only) |
| `\s+-n\s*` | `-n` flag with flexible spacing |
| `\d+` | One or more digits |
| `\s*` | Trailing whitespace |
| `g` | Global — removes all occurrences |

## Edge case handling

| Input | Behavior |
|---|---|
| `cat file \| head -n 50` | Stripped → `cat file` |
| `cat file \| tail -n5` | Stripped → `cat file` |
| `cat big.log \| head -n 100 \| tail -n 10` | Both pipes stripped → `cat big.log` |
| `  ps aux  \|    head -n 30` | Stripped → `  ps aux` |
| `grep foo bar \| tail -n   100` | Stripped → `grep foo bar` |
| `journalctl -u nginx \| tail -n   5` | Stripped → `journalctl -u nginx` |
| `ls -la` | No match — unchanged |
| `head -n 5 file.txt` | No pipe — unchanged |
| `grep -n pattern file` | `-n` is a flag, not `head\|tail` — unchanged |
| `cat file \| Head -n 50` | Case-sensitive, `Head` ≠ `head` — unchanged |
| Non-string `command` (null, undefined, number) | Silently returns |
| Non-bash tool call | Skipped |

## Compatibility

- Only affects the `bash` tool. `read`, `search`, `find`, and all non-bash tools pass through unchanged.
- Standalone `head`/`tail` without a preceding pipe are preserved (they are meaningful commands, not truncation).
- The regex is case-sensitive — `Head -n` or `HEAD -n` are not stripped.
- Multiple truncation pipes in sequence are all stripped in a single pass via the `g` flag.
- Trailing whitespace after the numeric argument is consumed.

## Full-suite compatibility

- Registration is guarded by a module-level `WeakSet` for idempotency.
- No dependencies, no configuration files, no environment variables.
- Notifications are sent via `ctx.ui.notify` with level `info`.

## Dependencies

None.

## Test

```bash
bun test
```
