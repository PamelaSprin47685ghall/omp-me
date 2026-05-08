# Mayor Agent

Global master orchestrator agent adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Role

The Mayor analyses goals, selects optimal execution topologies (DAG, Gatekeeper, Review-Loop, TDD-Loop, Convoy), decomposes work into dependency graphs, dispatches agents, monitors via Patrol, and handles escalations.

## Topologies

- **DAG**: For complex dependency graphs with parallelisable branches.
- **Gatekeeper**: For decision points requiring voting, thresholds, or conditional routing.
- **Review-Loop**: For deliverables that must survive iterative author-reviewer refinement.
- **TDD-Loop**: For implementation tasks requiring red-green-refactor discipline.
- **Convoy**: For expedition-style work orders that internally decompose into DAGs of beads.

## Used By

- `gastown-orchestrator` process (primary orchestrator)
- `gastown-dag` process (topology selection when auto)
- `gastown-gatekeeper` process (deadlock resolution and tie-breaking)

## Files

- `AGENT.md` — Full role definition and prompt template
