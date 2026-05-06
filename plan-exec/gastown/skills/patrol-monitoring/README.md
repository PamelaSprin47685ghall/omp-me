# Patrol Monitoring Skill

Master-level Deacon/Witness monitoring adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Purpose

Continuous event-driven health monitoring with progress-delta stuck detection, predictive failure analysis, and smart recovery across all Gas Town topologies.

## Process Flow

1. Ingest event logs for anomalies (errors, criticals, stalls)
2. Run health checks on agents, DAG nodes, review loops, TDD cycles, gates
3. Detect stuck agents by progress deltas, not just heartbeats
4. Predict failures via trend regression on health history
5. Execute recovery: retry-with-backoff, reassign, split-work, escalate
6. Generate patrol reports with trend analysis and predictive alerts

## Integration

- **Input from:** Active convoy, DAG, review-loop, tdd-loop, or gatekeeper execution
- **Output to:** Recovery actions, escalation alerts, patrol reports
- **Used by:** `gastown-patrol` process
