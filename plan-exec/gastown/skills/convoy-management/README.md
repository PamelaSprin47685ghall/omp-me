# Convoy Management Skill

Master-level convoy lifecycle management adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Purpose

Coordinate multi-agent work through convoy creation, internal DAG orchestration, embedded review-loop and TDD-loop execution, landing gatekeeper voting, and telemetry collection.

## Process Flow

1. Create convoy from goal with topology selection
2. Decompose into beads with dependencies and topology hints
3. Build internal DAG from beads and edges
4. Execute DAG with parallel branches
5. Run embedded loops (review-loop, tdd-loop) within beads
6. Gate landing via majority or unanimity vote
7. Collect telemetry and hand off to Refinery

## Integration

- **Input from:** Mayor orchestrator or manual convoy creation
- **Output to:** `merge-queue` (after landing)
- **Used by:** `gastown-convoy` process
