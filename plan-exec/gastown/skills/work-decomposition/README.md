# Work Decomposition Skill

Master-level work decomposition adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Purpose

Break high-level goals into DAG nodes with dependency edges, topology assignments, and acceptance criteria for master-level orchestration.

## Process Flow

1. Analyse the goal and project context
2. Identify sub-goals and classify by type (task, review-loop, tdd-loop, gate, convoy)
3. Map dependencies between sub-goals (data flow, ordering, shared interfaces)
4. Assign topology to each node based on risk and quality requirements
5. Define acceptance criteria with verifiable metrics (coverage, test pass, review accepted)
6. Estimate effort and flag critical paths
7. Validate the graph is acyclic

## Integration

- **Input from:** Mayor orchestrator or manual goal specification
- **Output to:** `agent-coordination`, `convoy-management`, `gastown-dag`
- **Used by:** `gastown-orchestrator` process
