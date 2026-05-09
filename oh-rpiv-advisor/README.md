# Oh Rpiv Advisor

Escalates to a stronger reviewer model for guidance. Wraps [@juicesharp/rpiv-advisor](https://www.npmjs.com/package/@juicesharp/rpiv-advisor) as an oh-my-pi extension.

Version: `1.0.0`.

## What it provides

| Capability | Name |
|---|---|
| Tool | `advisor` — escalate the current conversation to a stronger reviewer model |
| Command | `/advisor` — same escalation triggered via slash command |

## How it works

The extension loads `@juicesharp/rpiv-advisor` and bridges its API to oh-my-pi's `ExtensionAPI`. The bridge provides all the methods rpiv-advisor's runtime expects, including `getApiKeyAndHeaders` on the model registry (patched in if missing).

When invoked, the advisor tool pauses the current agent turn, opens a session with a stronger reviewer model, and returns the reviewer's analysis as context for the agent to continue.

### Bridge

The `createBridge` function maps oh-my-pi's `ExtensionAPI` to the `@mariozechner/pi-coding-agent` API that rpiv-advisor expects. Key mappings:

| oh-my-pi API | rpiv-advisor equivalent |
|---|---|
| `pi.registerTool(toolDef)` | `.registerTool(toolDef)` |
| `pi.registerCommand(name, opts)` | `.registerCommand(name, opts)` |
| `pi.on(event, handler)` | `.on(event, handler)` — `model_select` dropped |
| `pi.sendMessage(msg, opts)` | `.sendMessage(msg, opts)` |
| `pi.sendUserMessage(content, opts)` | `.sendUserMessage(content, opts)` |
| `pi.setModel(model)` | `.setModel(model)` |
| `pi.getActiveTools()` / `pi.setActiveTools()` | `.getActiveTools()` / `.setActiveTools()` |

## Installation

Place the `oh-rpiv-advisor` directory in one of these locations:

1. **Project-level**: `<project-root>/extensions/oh-rpiv-advisor/`
2. **User-level**: `~/.omp/extensions/oh-rpiv-advisor/`
3. **Via settings**: Add extension path in Oh My Pi settings

```bash
# Project-level (recommended)
mkdir -p extensions
cp -r oh-rpiv-advisor extensions/

# Or user-level
mkdir -p ~/.omp/extensions
cp -r oh-rpiv-advisor ~/.omp/extensions/
```

## Setup

```bash
cd oh-rpiv-advisor
bun install
```

## Usage

The LLM can invoke the `advisor` tool when it needs a stronger model's judgment:

- Code review with higher reasoning capacity
- Complex architectural decisions
- Security-sensitive analysis

Or trigger it manually via the `/advisor` command.

## Operational notes

- Depends on `@juicesharp/rpiv-advisor` — requires `bun install`.
- The bridge includes shim packages for `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, and `@mariozechner/pi-tui` to satisfy rpiv-advisor's import expectations.
- The `model_select` event is unsupported and silently dropped.
- Registration is guarded by a `WeakSet` for idempotency.

## Maintainer spec

See [`SPEC.md`](./SPEC.md) for bridge contract, API mapping, and compatibility rules.

## Test

```bash
bun test
```
