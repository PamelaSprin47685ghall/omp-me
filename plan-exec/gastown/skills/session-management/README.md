# Session Management Skill

Master-level session management adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Purpose

Manage Polecat identity persistence, Crew context maintenance, and Witness attestation logs across topology transitions and session teardowns.

## Process Flow

1. Initialise Polecat sessions with persistent identity
2. Accumulate telemetry (tests, coverage, lint, elapsed time) per identity
3. Preserve Crew context across beads, review rounds, and TDD cycles
4. Record architectural decisions and schema choices in context
5. Maintain Witness attestation logs for reviews, TDD cycles, and gate votes
6. Clean up sessions only after checkpoint preservation

## Integration

- **Input from:** All agent execution processes
- **Output to:** Attribution records, attestation logs, context handoffs
- **Used by:** `gastown-patrol` (health checks)
