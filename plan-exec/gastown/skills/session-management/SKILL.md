---
name: session-management
description: Manage Polecat identity persistence and Crew context maintenance across topology transitions and session teardowns.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch, WebSearch, Agent, AskUserQuestion
---

# Session Management

## Overview

Manage agent session lifecycle in Gas Town. Polecats are transient but their identity persists. Crew Leads are persistent and their context must survive across beads, review rounds, and TDD cycles. The Witness manages per-rig state and attestation logs.

## Polecat Identity

- Each Polecat has a persistent `AGENT_ID` across sessions.
- Telemetry (test count, coverage, lint issues, elapsed time) accumulates per identity.
- Partial progress on a bead is checkpointed before teardown.

## Crew Context

- Crew Leads maintain deep context across multiple beads in a convoy.
- Context must survive topology transitions (e.g., a bead moving from task to review-loop).
- Architectural decisions, interface choices, and schema designs are preserved.

## Witness Attestation

- The Witness records review-loop rounds, TDD cycle phases, and gate votes.
- Attestation logs are immutable and used for dispute resolution.
- Logs include: deliverable snapshot, reviewer IDs, verdicts, confidence scores, timestamps.

## Tool Use

Invoke via process: `methodologies/gastown/gastown-patrol` (session health checks)
