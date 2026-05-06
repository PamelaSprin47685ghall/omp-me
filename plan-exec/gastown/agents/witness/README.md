# Witness Agent

Master-level per-rig lifecycle manager adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Role

The Witness manages worker sessions on a rig and serves as an attestation layer for review loops, TDD cycles, and gate votes. It records immutable logs for dispute resolution.

## Capabilities

- **Session management**: Initialises workers, preserves Polecat identity, cleans up after checkpoint.
- **Review-loop attestation**: Records deliverable snapshots, reviewer IDs, verdicts.
- **TDD cycle validation**: Checks red-phase failure validity and refactor-phase test preservation.
- **Gate vote witnessing**: Records ballot details for audit.

## Used By

- `gastown-patrol` process (per-rig health)
- `gastown-review-loop` process (round attestation)
- `gastown-tdd-loop` process (cycle validation)
- `gastown-gatekeeper` process (vote witnessing)

## Files

- `AGENT.md` — Full role definition and prompt template
