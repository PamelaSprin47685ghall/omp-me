# Oh Tau Mirror

Web UI that mirrors your oh-my-pi terminal session in the browser. Powered by [tau-mirror](https://www.npmjs.com/package/tau-mirror).

Version: `1.0.0`.

## What it provides

| Capability | Name |
|---|---|
| Adapter | Registers tau-mirror as an oh-my-pi extension with a MITM proxy for multi-session event routing |

## How it works

`oh-tau-mirror` loads the `tau-mirror` npm package and bridges its API to oh-my-pi's `ExtensionAPI`. A local HTTP server (the proxy) sits between the browser and tau-mirror, adding multi-session routing so the browser can display multiple concurrent sessions (e.g. worker forks from squad).

Key behaviours:
- **Port interception**: captures tau-mirror's port from `setStatus` and rewrites the display to the proxy's port.
- **Console suppression**: tau-mirror's own console noise is silenced to keep the TUI clean.
- **Session tracking**: every `session_start` and catalog event registers the session file with the proxy for sidebar refresh.
- **Subagent streaming**: squad's `squad:subagent:stream` events are forwarded to the browser in real time.

## Installation

Place the `oh-tau-mirror` directory in one of these locations:

1. **Project-level**: `<project-root>/extensions/oh-tau-mirror/`
2. **User-level**: `~/.omp/extensions/oh-tau-mirror/`
3. **Via settings**: Add extension path in Oh My Pi settings

```bash
# Project-level (recommended)
mkdir -p extensions
cp -r oh-tau-mirror extensions/

# Or user-level
mkdir -p ~/.omp/extensions
cp -r oh-tau-mirror ~/.omp/extensions/
```

## Setup

```bash
cd oh-tau-mirror
bun install
```

## Usage

Once installed, tau-mirror starts automatically with oh-my-pi. Open the printed URL (`http://127.0.0.1:<port>`) in a browser, or append `/qr` for a QR code.

The web UI reflects the terminal session in real time, including:
- Conversation messages
- Multi-session sidebar (worker forks, subagents)
- Tool call details
- Active squad nodes

## Operational notes

- Depends on the `tau-mirror` npm package — requires `bun install`.
- The proxy adds a small latency overhead per event (sub-microsecond).
- Console output from tau-mirror is suppressed to avoid TUI clutter.
- Supports session file registration for accurate sidebar catalog.

## Maintainer spec

See [`SPEC.md`](./SPEC.md) for proxy architecture, event routing, and bridge contract.

## Test

```bash
bun test
```
