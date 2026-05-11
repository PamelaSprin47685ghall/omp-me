# Degrade

Replaces `role: system` with `role: user` in provider request messages. Some providers (e.g. Anthropic) lack a dedicated system role — this extension transparently converts it so messages reach the model as expected.

Version: `1.0.0`.

## What it provides

| Capability | Description |
|---|---|
| Event handler | Intercepts `before_provider_request` and rewrites system role entries to user role |

## How it works

Oh My Pi sends a `before_provider_request` event before dispatching a request to the LLM provider. The extension listens for this event, iterates the `payload.input` array, and changes every `{ role: 'system', ... }` item to `{ role: 'user', ... }` while preserving all other fields.

If the payload has no `input` array (e.g. a `messages`-based completion API path), the extension returns `undefined` — no modification, no interference.

## Installation

Place the `degrade` directory in one of these locations:

1. **Project-level**: `<project-root>/extensions/degrade/`
2. **User-level**: `~/.omp/extensions/degrade/`
3. **Via settings**: Add extension path in Oh My Pi settings

```bash
# Project-level (recommended)
mkdir -p extensions
cp -r degrade extensions/

# Or user-level
mkdir -p ~/.omp/extensions
cp -r degrade ~/.omp/extensions/
```

## Setup

No configuration needed.

## Usage

Once installed, every request to the LLM provider will have its `system` roles transparently rewritten to `user`. No agent-side or user-side changes required.

## Operational notes

- Only the `input` array path is processed (`messages`-based requests are left untouched).
- Other payload fields (`model`, `temperature`, `stream`, etc.) are preserved verbatim.
- Returns the modified payload object only when at least one `system` role was found and converted.
- For providers that do support a system role, disable this extension via settings.

## Maintainer spec

See [`SPEC.md`](./SPEC.md) for event contract, modification rules, and compatibility details.

## Test

```bash
bun test
```
