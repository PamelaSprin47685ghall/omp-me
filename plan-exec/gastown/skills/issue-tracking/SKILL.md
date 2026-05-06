---
name: issue-tracking
description: Track beads, review rounds, TDD cycles, gate votes, and conflict repairs as first-class issues with full audit trail.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch, WebSearch, Agent, AskUserQuestion
---

# Issue Tracking

## Overview

Track all work units and quality events in Gas Town as issues. This includes:
- Beads (nodes in a DAG)
- Review-loop rounds (author iterations, reviewer feedback)
- TDD cycles (red-green-refactor iterations)
- Gate votes (ballots, tie-breaks, deadlocks)
- Conflict repairs (fix agents, files modified, test results)

## Issue Types

| Type | Source | Fields |
|---|---|---|
| Bead | DAG node | id, type, status, assignedAgent, dependencies, acceptanceCriteria |
| Review Round | review-loop | round, deliverable, reviews, feedback, accepted |
| TDD Cycle | tdd-loop | cycle, redResult, greenResult, refactorResult, testsPassed |
| Gate Vote | gatekeeper | voterId, vote, confidence, reason, timestamp |
| Conflict Repair | merge-queue | round, conflict, fixAgent, filesModified, testResults |

## Audit Trail

Every issue transition is logged with:
- Timestamp
- Agent identity
- Topology context
- Before/after state

## Tool Use

Invoke via process: `methodologies/gastown/gastown-orchestrator` (tracking step)
