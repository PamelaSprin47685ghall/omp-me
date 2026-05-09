# Block Head Tail

Strips `| head -nXXX` and `| tail -nXXX` pipe truncation from bash tool calls. Prevents LLMs from silently discarding output that matters.

Version: `1.0.0`.

## What it provides

| Capability | Description |
|---|---|
| Event handler | Intercepts `tool_call` for the `bash` tool and removes trailing `\| head -nN` / `\| tail -nN` pipes |

## How it works

When the LLM calls `bash` with a command like `cat log | head -n 50`, the extension rewrites it to `cat log` before execution. The agent gets the full output and the user receives a notification listing what was stripped.

The regex matches `| head -n<digits>` and `| tail -n<digits>` with flexible spacing around the pipe and `-n` flag. Multiple truncation pipes in a single command are all removed.

## Installation

Place the `block-head-tail` directory in one of these locations:

1. **Project-level**: `<project-root>/extensions/block-head-tail/`
2. **User-level**: `~/.omp/extensions/block-head-tail/`
3. **Via settings**: Add extension path in Oh My Pi settings

```bash
# Project-level (recommended)
mkdir -p extensions
cp -r block-head-tail extensions/

# Or user-level
mkdir -p ~/.omp/extensions
cp -r block-head-tail ~/.omp/extensions/
```

## Setup

No configuration needed. The extension activates on import.

## Usage

Once installed, `| head -nN` and `| tail -nN` pipes are automatically stripped from every `bash` tool call. The LLM never sees truncated output.

The extension does **not** affect:
- Standalone `head`/`tail` commands (e.g. `head -n 5 file.txt` without a pipe)
- Other tools like `read`, `search`, `find`
- Non-bash tool calls

## Operational notes

- Registration is idempotent (guarded by WeakSet) — safe to reload the extension.
- Notifications show the original and modified command, plus which pipes were stripped.
- Workarounds: if you genuinely need truncated output, redirect to a file instead of piping to `head`/`tail`.

## Maintainer spec

See [`SPEC.md`](./SPEC.md) for regex contract, edge case handling, and compatibility rules.

## Test

```bash
bun test
```
