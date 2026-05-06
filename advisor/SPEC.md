# Advisor Spec

Version: `5.1.0`.

`README.md` covers usage. This file defines the API contract, error handling, and compatibility rules.

## Public surface

| Capability | Names |
|---|---|
| Tools | `advisor` |
| Commands | `/advisor` |
| Hooks | `session_start`, `before_agent_start` |

## API contract

### advisor tool

- **Parameters**: `{}` (no parameters required)
- **Behavior**: Escalates to a configured stronger model for guidance. The full conversation branch + tool inventory is forwarded.
- **Tool output**: Plain text guidance from the advisor model (plan, correction, or stop signal)
- **Tool details**: `{ advisorModel, effort, usage, stopReason, errorMessage? }`

### /advisor command

- **Description**: Configure the advisor model
- **Requires**: Interactive mode (UI)
- **Flow**: Model picker → optional effort picker (for reasoning models)
- **Persistence**: Saves to `~/.omp/advisor/advisor.json`

## Advisor model invocation

- Uses `ctx.app.lazyGet('pi-ai').completeSimple()`
- System prompt from `prompts/advisor-system.txt`
- Forwarded context: tool inventory message + conversation branch
- API key resolved via `ctx.modelRegistry.getApiKey()`
- Reasoning effort: `minimal | low | medium | high | xhigh` (model-dependent)

## Error handling

| Scenario | Behavior |
|---|---|
| No advisor model configured | Returns error: `No advisor model is configured. Use /advisor to enable one.` |
| API key unavailable | Returns error: `Advisor (provider:model) has no API key available.` |
| Call aborted | Returns error: `Advisor call was cancelled before it completed.` |
| Empty response | Returns error: `Advisor returned no text content.` |
| API call failed | Returns error: `Advisor call failed: <message>` |
| Exception thrown | Returns error: `Advisor call threw: <message>` |

## State management

- **In-memory**: `selectedAdvisor`, `selectedAdvisorEffort` (resets each session)
- **Persistence**: `~/.omp/advisor/advisor.json` (model key + effort level)
- **Session restore**: `session_start` handler reloads config and restores state

## Tool activation

- **Default**: Tool registered at load but NOT active (stripped in `before_agent_start` if no model selected)
- **On selection**: Tool added to active tools via `pi.setActiveTools()`
- **Disabled flow**: Selecting "No advisor" removes tool from active tools

## Full-suite compatibility

- Idempotent registration (WeakSet guard)
- Forked sessions and subagents inherit through Oh My Pi's extension discovery
- Config stored in `~/.omp/advisor/` (not `~/.config/gsd-advisor`)

## Dependencies

- `pi-ai` (via `ctx.app.lazyGet`)
- `pi-coding-agent` (via `ctx.app.lazyGet`)
- `pi-tui` (via `ctx.app.lazyGet`)
- No npm dependencies

## Test

```bash
npm test
```
