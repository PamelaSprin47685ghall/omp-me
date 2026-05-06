# Formula Authoring Skill

Master-level molecule formula authoring adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Purpose

Write durable, reusable molecule formulas supporting nested topologies: DAG, gatekeeper, review-loop, TDD-loop, and loop-until patterns with checkpointing and conditional branching.

## Process Flow

1. Define the molecule goal and acceptance criteria
2. Decompose into steps with type annotations (task, dag, gatekeeper, review-loop, tdd-loop, loop, molecule)
3. Configure checkpoint intervals for recovery
4. Add conditional branching via nextStepOverride
5. Nest sub-molecules for complex workflows
6. Validate formula structure before execution

## Integration

- **Input from:** `work-decomposition` or manual design
- **Output to:** `gastown-molecule` execution
- **Used by:** `gastown-molecule` process
