# Deacon Agent

Master-level system supervisor agent adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Role

The Deacon monitors agent health via event-driven telemetry and progress deltas, predicts failures via trend analysis, and orchestrates recovery with retry-backoff, reassign, split-work, or escalation strategies.

## Capabilities

- **Event-driven monitoring**: Reacts to event logs, not just scheduled pings.
- **Progress-delta detection**: Identifies stuck agents by unchanged metrics.
- **Predictive analysis**: Uses trend regression to alert before failure.
- **Smart recovery**: Chooses strategy based on failure pattern.

## Used By

- `gastown-patrol` process (primary monitoring)
- `gastown-orchestrator` process (health check after dispatch)

## Files

- `AGENT.md` — Full role definition and prompt template
