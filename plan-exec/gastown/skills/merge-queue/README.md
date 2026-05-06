# Merge Queue Skill

Master-level Refinery merge queue processing adapted from [Gas Town](https://github.com/steveyegge/gastown) by Steve Yegge.

## Purpose

Safely merge work from multiple agents with pre-merge quality gatekeeping, parallel DAG-based conflict repair, and full integration verification including coverage and mutation testing.

## Process Flow

1. Collect changes from agent branches
2. Run pre-merge quality gatekeeper vote on artifact completeness
3. Detect cross-module conflicts (API, schema, type, naming)
4. Dispatch fix agents for auto-resolvable conflicts as a parallel DAG
5. Merge in dependency order with conflict handling
6. Verify integration: build, type-check, lint, tests, coverage, mutation score
7. Escalate unresolvable conflicts with full audit trail

## Integration

- **Input from:** `convoy-management` after bead completion and landing gate
- **Output to:** Integrated codebase
- **Used by:** `gastown-merge-queue` process
