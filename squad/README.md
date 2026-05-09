# Squad

DAG-based multi-agent orchestration with mandatory Worker-Reviewer loops and native session switching for oh-my-pi.

Version: `1.0.0`.

## What it provides

| Capability | Name |
|---|---|
| Command | `/squad` — execute a task with concurrent workers and mandatory review |
| Command | `/squad-models` — generate initial model pool config |
| Tool | `submit_plan` — submit execution plan (mode M: single node, mode L: multi-node DAG) |

## How it works

Squad decomposes a task into a directed acyclic graph (DAG) of nodes. Each node is executed by a worker LLM session, then reviewed by a reviewer LLM session. Nodes that fail review are revised; nodes that depend on others wait for their prerequisites.

### Execution modes

- **M (single node, reviewable)**: One worker produces output, a reviewer checks it. Fast path for cohesive changes.
- **L (multi-module DAG)**: Multiple nodes execute in parallel where dependencies allow. After all nodes complete, an outer review loop evaluates the aggregate result. If rejected, the LLM revises and re-plans.

### Node lifecycle

`pending` → `running` → `awaiting_review` → `approved` / `rejected` / `failed`

Dependent nodes start as `waiting_deps` and transition to `pending` when all prerequisites are met.

### Outer review loop (L mode only)

After all DAG nodes finish, an outer reviewer evaluates the combined output against the original task. If rejected, the agent receives feedback and must call `submit_plan` again with a revised plan. This loop continues until approval or abort.

## Installation

Place the `squad` directory in one of these locations:

1. **Project-level**: `<project-root>/extensions/squad/`
2. **User-level**: `~/.omp/extensions/squad/`
3. **Via settings**: Add extension path in Oh My Pi settings

```bash
# Project-level (recommended)
mkdir -p extensions
cp -r squad extensions/

# Or user-level
mkdir -p ~/.omp/extensions
cp -r squad ~/.omp/extensions/
```

## Setup

Run `/squad-models` to generate an initial model pool config at `~/.omp/squad/models.json`. The config assigns worker and reviewer roles to available models. Edit the file to adjust concurrency (duplicate entries) or per-model `thinkingLevel`.

## Usage

```
/squad <task description>
```

The agent classifies the task as mode M or L, then calls `submit_plan` with the appropriate nodes. Each node includes a `task`, `review_criteria`, and optional `depends_on` for L-mode dependencies.

Press `Esc` / `Ctrl+C` to abort a running squad.

## Operational notes

- Registration is guarded by a boolean flag — only one squad instance per process.
- Workers run in separate forked sessions with `executeBash` capability.
- Reviewers use an independent model slot (configured in `models.json`).
- File integrity snapshots prevent tampering during review.
- The `squad_status` widget shows real-time progress in the TUI.

## Maintainer spec

See [`SPEC.md`](./SPEC.md) for node API contract, state machine transitions, and review lifecycle.

## Test

```bash
bun test
```
