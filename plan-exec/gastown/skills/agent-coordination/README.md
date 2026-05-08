# Agent Coordination Skill

Master-level multi-agent coordination adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Purpose

Coordinate Crew Leads, Polecats, and Refinery across DAG, gatekeeper, review-loop, and TDD-loop topologies with topology-aware dispatch, context preservation, and smart recovery.

## Process Flow

1. Analyse topology requirements (DAG, gatekeeper, review-loop, tdd-loop, convoy)
2. Match agent roles to topology nodes using the Agent Topology Matrix
3. Dispatch agents with topology-specific context
4. Preserve context across topology transitions
5. Monitor progress and execute topology-aware recovery
6. Track attribution across DAG branches, review rounds, and TDD cycles

## Integration

- **Input from:** `work-decomposition` (DAG nodes with topology hints)
- **Output to:** `convoy-management`, `gastown-dag`, `gastown-review-loop`, `gastown-tdd-loop`
- **Used by:** Mayor orchestrator
