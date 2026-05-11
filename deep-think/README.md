# Deep Think

Gives the LLM extra time and depth to think through complex problems. Wraps [@juicesharp/rpiv-advisor](https://www.npmjs.com/package/@juicesharp/rpiv-advisor) as an oh-my-pi extension.

Version: `1.0.0`.

## What it provides

| Capability | Name |
|---|---|
| Tool | `deep-think` — spend extra time and depth thinking through complex problems |
| Command | `/deep-think` — same boost triggered via slash command |

## How it works

The extension loads `@juicesharp/rpiv-advisor` and bridges its API to oh-my-pi's `ExtensionAPI`, renaming the tool to `deep-think` so the LLM happily invokes it whenever deeper reasoning is needed.

When invoked, the deep-think tool pauses the current agent turn, spends extra time reasoning through the problem, and returns the analysis as context for the agent to continue.

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

Place the `deep-think` directory in one of these locations:

1. **Project-level**: `<project-root>/extensions/deep-think/`
2. **User-level**: `~/.omp/extensions/deep-think/`
3. **Via settings**: Add extension path in Oh My Pi settings

```bash
# Project-level (recommended)
mkdir -p extensions
cp -r deep-think extensions/

# Or user-level
mkdir -p ~/.omp/extensions
cp -r deep-think ~/.omp/extensions/
```

## Setup

```bash
cd deep-think
bun install
```

## Usage

The LLM can invoke the `deep-think` tool when it wants to boost its reasoning:

- Deeper code review
- Complex architectural decisions
- Security-sensitive analysis

Or trigger it manually via the `/deep-think` command.

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
