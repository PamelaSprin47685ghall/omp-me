---
name: work-decomposition
description: Decompose goals into DAG nodes (beads) with dependency edges, topology assignments, and acceptance criteria following Gas Town's master-level work model.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch, WebSearch, Agent, AskUserQuestion
---

# Work Decomposition

## Overview

Break high-level goals into trackable atomic units at master level. Each unit becomes a DAG node with:
- **Type**: `task`, `review-loop`, `tdd-loop`, `gate`, `convoy`
- **Dependencies**: upstream node IDs that must complete before this node can run
- **Topology hint**: which Gas Town engine should execute it
- **Acceptance criteria**: verifiable conditions for completion

The output is a dependency graph, not a flat list. The Mayor uses this graph to select the global topology (DAG, gatekeeper, review-loop, tdd-loop, convoy) and dispatch work.

## When to Use

- Before creating a convoy or orchestrating any multi-agent effort
- When the goal has clear sub-goals with ordering constraints
- When quality gates, iterative review, or TDD are required for specific sub-goals
- When parallel execution can speed up independent branches

## Process

1. **Analyse** the goal and project context.
2. **Identify sub-goals** and classify each:
   - Pure implementation → `task` or `tdd-loop`
   - Requires design review → `review-loop`
   - Decision point → `gate`
   - Complex expedition → `convoy`
3. **Map dependencies** between sub-goals (data flow, ordering, shared interfaces).
4. **Assign topology** to each node based on risk and quality requirements.
5. **Define acceptance criteria** for each node with verifiable metrics.
6. **Estimate effort** and flag critical paths.

## Decomposition Principles

- A node should be completable by a single agent, but may internally use loops (review, TDD).
- Dependencies should form a DAG; cycles must be broken with temporary interfaces or mocked outputs.
- High-risk nodes get `review-loop` or `tdd-loop` topology; low-risk nodes get `task`.
- Gate nodes sit at integration points, requiring majority or unanimity votes to proceed.
- Acceptance criteria must be testable: "passes tests", "coverage > 80%", "review accepted".

## Tool Use

Invoke via process: `methodologies/gastown/gastown-orchestrator` (analysis step)
