# Polecat Agent

Master-level transient task worker agent adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Role

The Polecat is a transient task worker with persistent identity. It self-verifies deliverables, participates in TDD green phases, reviews peers in review loops, and casts informed votes in gatekeepers.

## Modes

- **Single-bead execution**: Deep work on one bead with self-verification.
- **TDD green-phase**: Minimal change to make a failing test pass.
- **Peer reviewer**: Reviews other Polecats' beads with specific comments.
- **Gate voter**: Casts votes with confidence scores and reasoning.

## Used By

- `gastown-convoy` process (isolated bead execution)
- `gastown-tdd-loop` process (green-phase implementation)
- `gastown-review-loop` process (peer reviewer)
- `gastown-gatekeeper` process (ballot casting)

## Files

- `AGENT.md` — Full role definition and prompt template
