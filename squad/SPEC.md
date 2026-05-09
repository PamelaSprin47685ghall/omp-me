# Squad Spec

Version: `1.0.0`.

`README.md` covers usage. This file defines the node API contract, state machine transitions, and review lifecycle.

## Public surface

| Capability | Detail |
|---|---|
| Commands | `/squad`, `/squad-models` |
| Tool | `submit_plan` (default inactive — activated by `/squad`) |
| Events | `agent_end`, `session_shutdown`, `input` |
| Widget | `squad_status` |

## submit_plan API

```ts
{
  mode: 'M' | 'L';
  reasoning: string;
  nodes: Array<{
    id: string;
    task: string;
    review_criteria: string | string[];
    depends_on?: string[];
  }>;
}
```

### Validation rules

| Rule | Error |
|---|---|
| Mode must be `M` or `L` | `mode must be M or L` |
| Nodes must be a non-empty array | `nodes required` |
| M mode requires exactly 1 node | `M mode requires exactly 1 node` |
| Each node needs `id`, `task`, `review_criteria` | `node "?" missing required fields` |
| `review_criteria` must be string or string[] | `must be a string or an array of strings` |
| `depends_on` references must exist in node set | `depends on unknown node: "X"` |

## Node state machine

### States

| State | Meaning |
|---|---|
| `pending` | Ready to execute |
| `running` | Worker session in progress |
| `awaiting_review` | Worker finished, reviewer in progress |
| `awaiting_confirmation` | Reviewer approved, waiting for user confirm |
| `approved` | Node completed successfully |
| `rejected` | Reviewer rejected the output |
| `failed` | Worker or reviewer threw an error |
| `blocked` | A dependency failed or was rejected |
| `waiting_deps` | Dependencies not yet met |
| `skipped` | Aborted or cancelled |

### Events

| Event | Transition |
|---|---|
| `start` | `waiting_deps` → `pending` |
| `start` | `pending` → `running` |
| `worker_done` | `running` → `awaiting_review` |
| `review_approved` | `awaiting_review` → `awaiting_confirmation` |
| `review_rejected` | `awaiting_review` → `rejected` |
| `confirmed` | `awaiting_confirmation` → `approved` |
| `retry` | `rejected` → `pending` (up to MAX_RETRIES = ∞) |
| `fail` | Any → `failed` (on unhandled error) |
| `block` | Any → `blocked` (dependency failed) |

MAX_RETRIES is `Infinity` — the worker-reviewer loop for a single node retries until approval, abort, or unrecoverable error.

### Max empty turns

Each session has a max-empty-turn guard:
- Worker: 20 empty turns before forced re-deliberation
- Confirm: 5 empty turns before forced re-deliberation

## Worker session

Each node spawns a worker session with:

- The node's `task` as the prompt
- Upstream results (dependencies' approved outputs) merged as context
- Reviewer feedback (if retrying) included as revision guidance
- Tools: `executeBash`, `read`, `write`, `edit`, `search`, `find`, `lsp`, `eval`
- A `return_work` lifecycle tool for signalling completion

## Reviewer session

After the worker completes, a reviewer session evaluates the output against `review_criteria`.

- Prompt includes the node's task, worker output, upstream results
- Tools: `approve`, `reject` (lifecycle tools)
- Review dimensions: correctness, completeness, safety, style, edge cases, performance

## Confirming phase (optional)

If the reviewer approves, the user may optionally confirm before the result is accepted. Controlled by the plan's confirm settings.

## Outer review loop (L mode only)

After all DAG nodes complete, an outer reviewer evaluates the combined result against the original task.

If rejected:
- FSM transitions to `revising` state
- Agent receives feedback and must call `submit_plan` with a revised plan
- The `agent_end` hook forces the agent to call `submit_plan` if it tries to end the turn without doing so

If approved, the squad finishes and `submit_plan` is deactivated.

## DAG execution

- Nodes are topologically sorted into execution layers
- Each layer runs with configurable concurrency (default: 5)
- A layer completes before the next layer starts
- If any node in a layer fails, downstream nodes are marked `blocked`

## Error handling

| Scenario | Behavior |
|---|---|
| Node worker throws | Node marked `failed`, downstream nodes blocked |
| Reviewer throws | Node marked `failed`, retried on next outer round |
| Session abort (signal) | All running sessions cancelled, squad terminates |
| Invalid `submit_plan` call | Returns `isError` response with validation message |
| `/squad` called while active | Notifies user, ignored |

## Full-suite compatibility

- Registration guarded by module-level boolean flag.
- Active runs tracked per session ID — cleaned up on `session_shutdown`.
- The `submit_plan` tool is toggled active/inactive based on squad state.
- Widget state cleared on session shutdown or squad completion.
- Model pool config persisted at `~/.omp/squad/models.json`.

## Dependencies

None (pure oh-my-pi extension).

## Test

```bash
bun test
```
