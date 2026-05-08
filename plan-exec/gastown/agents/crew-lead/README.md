# Crew Lead Agent

Master-level persistent collaborator agent adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Role

The Crew Lead maintains deep context across multiple beads and topologies. Leads architecture decisions, mentors Polecats, participates in review loops as author or reviewer, and drives TDD cycles for implementation beads.

## Modes

- **DAG node execution**: Owns complex nodes with architectural implications.
- **Review-Loop author**: Produces deliverables with reviewer guidance in mind.
- **Review-Loop senior reviewer**: Provides architectural feedback with severity labels.
- **TDD-Loop leader**: Defines test strategy and guards against over-engineering.
- **Gatekeeper voter**: Casts justified ballots with confidence scores.

## Used By

- `gastown-convoy` process (bead execution, landing gate)
- `gastown-review-loop` process (author or reviewer)
- `gastown-tdd-loop` process (red-phase design and refactor guarding)

## Files

- `AGENT.md` — Full role definition and prompt template
