---
name: formula-authoring
description: Write durable molecule formulas supporting nested topologies: DAG, gatekeeper, review-loop, TDD-loop, and loop-until patterns.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch, WebSearch, Agent, AskUserQuestion
---

# Formula Authoring

## Overview

Write durable, reusable molecule formulas for Gas Town. A formula defines a sequence of steps, where each step can be:

- A plain task
- A nested molecule
- A delegated DAG
- A gatekeeper vote
- A review-loop
- A TDD-loop
- A loop-until construct

## Formula Structure

```json
{
  "steps": [
    { "type": "task", "task": "Analyse requirements" },
    { "type": "dag", "graph": { "nodes": [...], "edges": [...] } },
    { "type": "gatekeeper", "ballots": [...], "mode": "majority" },
    { "type": "review-loop", "author": {...}, "reviewers": [...] },
    { "type": "tdd-loop", "red": {...}, "green": {...}, "refactor": {...} },
    { "type": "loop", "condition": "ctx.result.passed", "body": [...], "maxIterations": 5 },
    { "type": "molecule", "nestedFormula": {...} }
  ]
}
```

## Checkpointing

Set `checkpointInterval` to save progress every N steps. Recovery resumes from the last checkpoint.

## Conditional Branching

Steps can return `nextStepOverride` to jump to a specific step index, enabling conditional branching within a formula.

## Tool Use

Invoke via process: `methodologies/gastown/gastown-molecule`
