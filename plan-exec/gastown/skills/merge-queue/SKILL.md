---
name: merge-queue
description: Process the Refinery merge queue with pre-merge quality gatekeeping, parallel DAG-based conflict repair, and full integration verification including coverage and mutation testing.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch, WebSearch, Agent, AskUserQuestion
---

# Merge Queue (Refinery)

## Overview

The Refinery is Gas Town's master-level per-rig merge queue processor. It does not simply collect changes and merge sequentially. It:

1. **Quality-gates** all artifacts via a Gatekeeper vote before merge.
2. **Collects** pending changes from all agent branches.
3. **Detects** cross-module conflicts (API, schema, type, naming).
4. **Repairs** auto-resolvable conflicts by dispatching fix agents as a parallel DAG.
5. **Verifies** integration: build, type-check, lint, tests, coverage threshold, mutation score.
6. **Escalates** unresolvable conflicts with full audit trail.

## When to Use

- After convoy beads are complete and ready to merge
- When multiple convoys may touch shared interfaces or schemas
- Before declaring a release or integration milestone
- When coverage or mutation scores are contractually required

## Process

1. **Collect** pending changes from all agent branches.
2. **Quality Gate**: Run a gatekeeper vote on artifact completeness.
3. **Detect** conflicts between branches and shared modules.
4. **Resolve** auto-resolvable conflicts in parallel DAG.
5. **Merge** in dependency order with conflict handling.
6. **Verify** integration with full test suite, coverage, and optional mutation testing.
7. **Escalate** unresolvable conflicts with audit trail.

## Conflict Strategies

- **auto**: Attempt automatic resolution via parallel DAG fix agents; escalate on failure.
- **manual**: Flag all conflicts for human resolution.
- **skip**: Drop conflicting changes (dangerous; requires gatekeeper approval).

## Quality Gate Modes

- **majority**: > 50% of beads must pass quality check.
- **unanimity**: All beads must pass.
- **threshold**: Configurable percentage (e.g., 75%).

## Tool Use

Invoke via process: `methodologies/gastown/gastown-merge-queue`
