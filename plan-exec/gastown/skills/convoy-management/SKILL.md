---
name: convoy-management
description: Create, track, and land master-level convoys with internal DAG orchestration, review loops, TDD cycles, and landing gatekeeper votes.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch, WebSearch, Agent, AskUserQuestion
---

# Convoy Management

## Overview

Manage the full lifecycle of Gas Town convoys at master level: creation from a goal, bead decomposition into a dependency graph, internal DAG execution, agent assignment, review-loop and TDD-loop integration, landing gatekeeper vote, and telemetry collection.

Convoys are no longer simple sequential work orders. A master-level convoy internally orchestrates beads as a DAG, gates its landing via majority vote, and can embed review or TDD loops within individual beads.

## When to Use

- Starting a new multi-agent work effort with complex dependencies
- A bead requires iterative refinement (review-loop) or test-driven implementation (TDD-loop)
- Landing quality must be gated before merge
- Work decomposes into parallelisable branches

## Process

1. **Decompose** the goal into beads with dependencies and topology hints.
2. **Build internal DAG** from beads and their dependency edges.
3. **Execute DAG** via `gastown-dag.js`, parallelising independent branches.
4. **Run embedded loops** within beads (review-loop, tdd-loop) via `gastown-molecule.js`.
5. **Gate landing** via `gastown-gatekeeper.js` majority vote.
6. **Collect telemetry** (test count, coverage, review rounds, TDD cycles) for attribution.
7. **Land** via the chosen strategy; reject if gate fails.
8. **Hand off** to the Refinery merge queue.

## Key Concepts

- **Convoy**: Self-contained expedition wrapping a DAG of related beads.
- **Internal DAG**: Beads are nodes; dependencies are edges. Independent branches run in parallel.
- **Embedded Review**: A bead of type `review-loop` runs author-reviewer cycles until accepted.
- **Embedded TDD**: A bead of type `tdd-loop` runs red-green-refactor cycles with coverage gating.
- **Landing Gate**: Before merge, a gatekeeper vote assesses bead quality and completeness.

## Agents Used

- `agents/mayor/` — Creates and coordinates convoys
- `agents/crew-lead/` — Persistent collaborators for architecture-critical beads
- `agents/polecat/` — Transient workers for isolated, well-specified beads
- `agents/refinery/` — Integration enforcer for merge queues
- `agents/witness/` — Per-rig lifecycle manager and attestation

## Tool Use

Invoke via process: `methodologies/gastown/gastown-convoy`
