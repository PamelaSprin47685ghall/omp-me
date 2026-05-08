---
name: agent-coordination
description: Coordinate Crew, Polecats, and Refinery across DAG, gatekeeper, review-loop, and TDD-loop topologies with topology-aware dispatch and recovery.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch, WebSearch, Agent, AskUserQuestion
---

# Agent Coordination

## Overview

Coordinate Gas Town agents across advanced topologies. This skill covers:

- Topology-aware dispatch (which agent type for which topology)
- Cross-topology context preservation
- Recovery and reassignment with topology-specific strategies
- Attribution tracking across DAG branches, review rounds, and TDD cycles

## When to Use

- Assigning agents to nodes in a DAG
- Configuring review-loop author and reviewer pools
- Selecting green-phase implementers for TDD loops
- Reassigning stuck agents with topology-aware recovery

## Agent Topology Matrix

| Topology    | Primary                              | Secondary                       | Gate / Review                 |
| ----------- | ------------------------------------ | ------------------------------- | ----------------------------- |
| DAG         | Crew Lead (complex nodes)            | Polecat (simple nodes)          | Refinery (integration points) |
| Gatekeeper  | Refinery (quality)                   | Crew Lead (architectural)       | Polecat (peer vote)           |
| Review-Loop | Crew Lead (author / senior reviewer) | Polecat (peer reviewer)         | Refinery (arbiter)            |
| TDD-Loop    | Crew Lead (red-phase design)         | Polecat (green-phase implement) | Refinery (coverage gate)      |
| Convoy      | Crew Lead (expedition lead)          | Polecat (bead workers)          | Refinery (landing gate)       |

## Recovery Strategies

- **DAG node stuck**: Retry with backoff, then reassign to another agent of same role.
- **Review-loop deadlock**: Inject arbitration agent or reduce reviewer count.
- **TDD-loop red phase false pass**: Escalate to Crew Lead for test redesign.
- **Gatekeeper tie**: Apply tie-breaker policy (escalate, random, yes, no).

## Tool Use

Invoke via process: `methodologies/gastown/gastown-orchestrator` (dispatch step)
