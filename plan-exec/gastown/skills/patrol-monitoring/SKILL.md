---
name: patrol-monitoring
description: Continuous event-driven monitoring using Deacon/Witness patterns for agent health checks, progress-delta stuck detection, predictive failure analysis, and automated recovery.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch, WebSearch, Agent, AskUserQuestion
---

# Patrol Monitoring

## Overview

Master-level continuous monitoring using Gas Town's Deacon/Witness pattern with event-driven telemetry. The Deacon supervises overall health via event logs and progress deltas, the Witness manages per-rig agent lifecycle and attests reviews/votes/gates, and the Boot (Dog) watches the Deacon itself.

## When to Use

- During active convoy, DAG, review-loop, or TDD-loop execution
- When predictive failure alerts are needed before collapse
- After topology changes or agent reassignments
- Before and after merge-queue execution

## Process

1. **Event ingestion**: Scan event logs for anomalies (errors, criticals, stalls).
2. **Health check**: Assess heartbeats, progress deltas, DAG completion rates, review-loop round counts, gate latencies.
3. **Predictive analysis**: Run trend regression on health history; alert on declining slopes.
4. **Stuck detection**: Identify agents with unchanged metrics across cycles.
5. **Recovery**: Execute retry-with-backoff, reassign, split-work, or escalate.
6. **Report**: Generate patrol summary with trend analysis and recommendations.

## Monitoring Dimensions

- **Agent health**: Heartbeats, error rates, session state.
- **DAG progress**: Node completion rate, critical path lag, parallel branch balance.
- **Review-loop status**: Round counts, rejection rates, arbitration triggers.
- **TDD-cycle status**: Cycle counts, red-phase validity, coverage trends.
- **Gate latency**: Time from ballot cast to resolution; deadlock detection.

## Recovery Modes

- **retry-with-backoff**: Transient errors; exponential backoff.
- **reassign**: Agent permanently stuck or crashed.
- **split-work**: Bead too large; partition into sub-beads and parallelise.
- **escalate**: Unresolvable or architectural blockers.

## Tool Use

Invoke via process: `methodologies/gastown/gastown-patrol`
