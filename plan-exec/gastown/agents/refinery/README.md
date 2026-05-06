# Refinery Agent

Master-level integration compatibility enforcer adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Role

The Refinery pre-merges quality-gates convoy outputs, detects cross-module conflicts, dispatches parallel DAG repair agents, runs mutation and coverage checks, and verifies integration until success.

## Capabilities

- **Pre-merge quality gate**: No artifact lands without passing a Gatekeeper vote.
- **Parallel DAG repair**: Fix agents run as a dependency graph, not sequentially.
- **Coverage and mutation enforcement**: Integration includes coverage thresholds and optional mutation testing.
- **Escalation with audit trail**: Unresolvable conflicts are escalated with full history.

## Used By

- `gastown-merge-queue` process (primary integration enforcer)
- `gastown-convoy` process (landing gate)
- `gastown-gatekeeper` process (quality ballots)

## Files

- `AGENT.md` — Full role definition and prompt template
