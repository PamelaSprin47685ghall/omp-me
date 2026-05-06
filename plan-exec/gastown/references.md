# Gas Town References and Attribution

## Primary Source

- **Repository**: [https://github.com/steveyegge/gastown](https://github.com/steveyegge/gastown)
- **Author**: Steve Yegge
- **License**: See upstream repository

## Concepts Adapted

The following Gas Town concepts have been adapted into master-level process definitions:

### Infrastructure Roles
- **Mayor**: Global orchestrator with topology selection → `gastown-orchestrator.js`, `gastown-dag.js`, `gastown-gatekeeper.js`
- **Deacon**: Predictive system supervisor → `gastown-patrol.js`
- **Witness**: Per-rig lifecycle manager and attestation layer → integrated into all loop and gate processes
- **Refinery**: Integration enforcer with quality gates and parallel repair → `gastown-merge-queue.js`

### Worker Roles
- **Crew**: Persistent architecture lead → `agents/crew-lead/`
- **Polecats**: Transient self-verifying workers → `agents/polecat/`
- **Dogs (Boot)**: Watches the Deacon → referenced in `gastown-patrol.js`

### Execution Topologies
- **DAG**: Directed acyclic graph with parallel branches and conditional edges → `gastown-dag.js`
- **Gatekeeper**: Voting and conditional routing → `gastown-gatekeeper.js`
- **Review-Loop**: Author-reviewer refinement with quorum → `gastown-review-loop.js`
- **TDD-Loop**: Red-green-refactor with coverage/mutation gating → `gastown-tdd-loop.js`
- **Convoy**: Enhanced expedition with internal DAG and landing gate → `gastown-convoy.js`
- **Molecule**: Durable nested workflow engine → `gastown-molecule.js`

### Work Units
- **Bead**: Git-backed atomic work unit with topology hints → nodes in `gastown-dag.js`
- **Wisp**: Ephemeral task → inline steps in `gastown-molecule.js`
- **Convoy**: Expedition wrapping a DAG of beads → `gastown-convoy.js`

### Core Principles
- **GUPP**: Gas Town Universal Propulsion Principle
- **Topology-aware execution**: The right shape for the right work
- **Quality gating**: No merge without passing votes
- **Predictive monitoring**: Trend analysis before failure
- **Attribution tracking**: Every action is attributed

## Acknowledgment

This master-level adaptation extends Gas Town's original multi-agent orchestration patterns with advanced topologies (DAG, Gatekeeper, Review-Loop, TDD-Loop), predictive monitoring, and quality-gated integration. All credit for the original concepts, terminology, and design philosophy belongs to Steve Yegge and the Gas Town project contributors.
