# Gas Town Methodology — Master Level

**Source**: [steveyegge/gastown](https://github.com/steveyegge/gastown) by Steve Yegge
**Category**: Multi-Agent Orchestration / AI-Driven Software Development
**License**: See upstream repository

## Overview

Gas Town is a master-level multi-agent orchestration framework for AI-driven software development. It provides advanced execution topologies — **DAG**, **Gatekeeper**, **Review-Loop**, **TDD-Loop** — on top of the original git-backed work unit system (Beads, Convoys, Molecules). Infrastructure roles (Mayor, Deacon, Witness, Refinery) and worker roles (Crew, Polecats, Dogs) coordinate parallel agent execution with persistent attribution, quality gating, and predictive monitoring.

## Core Principles

- **GUPP** (Gas Town Universal Propulsion Principle): "If there is work on your Hook, YOU MUST RUN IT"
- **Topology-aware execution**: The Mayor selects DAG, Gatekeeper, Review-Loop, TDD-Loop, or Convoy based on the shape of work.
- **Quality gating**: No artifact merges without passing a Gatekeeper vote.
- **Predictive monitoring**: The Deacon predicts failures before they happen via trend analysis.
- **Attribution tracking**: Every bead, review, vote, and fix is attributed to an agent for evaluation.

## Execution Topologies

| Topology | File | Description | When to Use |
|---|---|---|---|
| **DAG** | `gastown-dag.js` | Dependency graph execution with parallel branches, conditional edges, retry backoff | Complex work with ordering constraints and parallelisable sub-tasks |
| **Gatekeeper** | `gastown-gatekeeper.js` | Voting and conditional routing: majority, unanimity, threshold, any-of, custom | Decision points, quality gates, merge approval |
| **Review-Loop** | `gastown-review-loop.js` | Author-reviewer refinement cycle with quorum and arbitration | Deliverables requiring architectural or quality review |
| **TDD-Loop** | `gastown-tdd-loop.js` | Red-green-refactor with coverage gating and optional mutation testing | Implementation tasks where test discipline is required |
| **Convoy** | `gastown-convoy.js` | Enhanced expedition with internal DAG, embedded loops, landing gate | Expedition-style work orders that decompose into complex bead graphs |
| **Molecule** | `gastown-molecule.js` | Durable multi-step workflow supporting nested DAGs, loops, gates, reviews | Reusable workflow templates with checkpointing |
| **Merge Queue** | `gastown-merge-queue.js` | Pre-merge quality gate + parallel DAG conflict repair + full integration verification | Post-convoy integration with strict quality requirements |
| **Patrol** | `gastown-patrol.js` | Event-driven health monitoring with predictive alerts and smart recovery | Continuous supervision during active execution |

## Process Files

| Process | File | Description | Task Count |
|---|---|---|---|
| Orchestrator | `gastown-orchestrator.js` | Analyses goal, selects topology, decomposes into DAG, dispatches, monitors, integrates | 6 |
| DAG Engine | `gastown-dag.js` | Topological sort, parallel execution, conditional routing, retry | 1 |
| Gatekeeper | `gastown-gatekeeper.js` | Vote aggregation, tie-breaking, deadlock resolution | 1 |
| Review Loop | `gastown-review-loop.js` | Author-reviewer cycles with quorum and arbitration | 1 |
| TDD Loop | `gastown-tdd-loop.js` | Red-green-refactor with coverage and mutation gating | 1 |
| Convoy | `gastown-convoy.js` | Enhanced bead lifecycle with internal DAG and landing gate | 5 |
| Merge Queue | `gastown-merge-queue.js` | Quality gate, parallel conflict repair, integration verification | 6 |
| Patrol | `gastown-patrol.js` | Event-driven monitoring, predictive analysis, recovery | 5 |
| Molecule | `gastown-molecule.js` | Durable nested workflow engine | 1 |
| Entry Point | `main.js` | Dispatches to any topology by mode | 1 |

## Skills Catalog

| Skill | Directory | Description |
|---|---|---|
| Convoy Management | `skills/convoy-management/` | Create, track, and land master-level convoys with internal DAGs |
| Work Decomposition | `skills/work-decomposition/` | Decompose goals into DAG nodes with topology hints |
| Merge Queue | `skills/merge-queue/` | Run the Refinery with quality gates and parallel repair |
| Patrol Monitoring | `skills/patrol-monitoring/` | Event-driven health checks and predictive alerts |
| Agent Coordination | `skills/agent-coordination/` | Coordinate Crew, Polecats, and Refinery across topologies |
| Formula Authoring | `skills/formula-authoring/` | Write durable molecule formulas with nested topologies |
| Issue Tracking | `skills/issue-tracking/` | Track beads, review rounds, and TDD cycles |
| Session Management | `skills/session-management/` | Manage Polecat identity and Crew context persistence |

## Agents Catalog

| Agent | Directory | Role |
|---|---|---|
| Mayor | `agents/mayor/` | Global orchestrator; selects topologies and dispatches |
| Crew Lead | `agents/crew-lead/` | Persistent collaborator; leads architecture, review, TDD |
| Polecat | `agents/polecat/` | Transient worker; self-verifies, reviews peers, votes in gates |
| Deacon | `agents/deacon/` | System supervisor; event-driven monitoring, predictive alerts |
| Refinery | `agents/refinery/` | Integration enforcer; quality gates, parallel conflict repair |
| Witness | `agents/witness/` | Per-rig manager; attests reviews, TDD cycles, gate votes |

## Workflow Lifecycle

```
Goal
  |
  v
Orchestrator (Mayor) --[analyses topology]--> DAG / Gatekeeper / Review-Loop / TDD-Loop / Convoy
  |
  v
Decomposition --[nodes + edges]--> DAG of beads
  |
  v
Dispatch --[parallel branches]--> Crew / Polecat agents
  |
  v
Embedded loops --[per bead]--> Review-Loop / TDD-Loop
  |
  v
Landing Gate --[Gatekeeper vote]--> pass / reject
  |
  v
Refinery Merge Queue --[quality gate + conflict repair]--> Integration
  |
  v
Patrol --[event-driven monitoring]--> Health & Recovery
```

Cross-cutting concerns applied throughout:
- `patrol-monitoring` — Event-driven health checks via Deacon
- `agent-coordination` — Topology-aware dispatch and recovery
- `session-management` — Polecat identity and Crew context persistence

## Work Unit Hierarchy

```
Goal
  |
  +-- Topology (DAG / Gatekeeper / Review-Loop / TDD-Loop / Convoy)
        |
        +-- Convoy (expedition)
              |
              +-- DAG of Beads (nodes with dependency edges)
                    |
                    +-- Bead (atomic work unit)
                          |
                          +-- Review-Loop (author-reviewer cycles)
                          +-- TDD-Loop (red-green-refactor cycles)
                          +-- Task (single execution)
                    |
                    +-- Gate (conditional routing / vote)
              |
              +-- Wisp (ephemeral task)
        |
        +-- Molecule (reusable workflow formula)
```

## Philosophy

- **Topology over sequence**: Choose the right shape of execution for the work, not just one-after-another.
- **Quality before speed**: Gate every landing and merge; iterate via review and TDD until the bar is met.
- **Predict over react**: Monitor progress deltas and trends, not just heartbeats; fix problems before they cascade.
- **Parallel by default**: Independent branches run concurrently; only serialise on true dependencies.
- **Attribution is accountability**: Every action is attributed so agents learn and improve.
