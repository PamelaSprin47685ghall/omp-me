# Plan & Execute

Orchestrate complex tasks by writing JavaScript that forks sub-agents with typed return schemas.

Version: `5.1.0`.

## What it provides

| Capability | Name |
|---|---|
| Tool | `plan_exec` — write JS to fork sub-agents and orchestrate their results |
| Hooks | `session_start`, `input`, `session_shutdown` |

## How it works

The `plan_exec` tool accepts a string of JavaScript code. Your code defines an `async function main(args, task, taskjs)` and calls `await task(prompt, schema)` to spawn LLM sub-agents, or `await taskjs(filePath, args)` to execute a local JS file.

- `task()` forks a child LLM session with the same model/tools/context as the parent.
- `taskjs(filePath, args)` executes a local JS file that defines `async function main(args, task, taskjs)`. The path is resolved relative to the **calling file's directory** (not cwd), so sibling files in the same folder can be referenced naturally.
- Each LLM fork gets a dedicated `return` tool bound to the schema you provide.
- The child must call `return(result)` to finish; the result is returned to the orchestrator.
- Use standard JS control flow: `if`, `for`, `while`, `Promise.all`, `Promise.race`.

## Installation

Place the `plan-exec` directory in one of these locations:

1. **Project-level**: `<project-root>/extensions/plan-exec/`
2. **User-level**: `~/.omp/extensions/plan-exec/`
3. **Via settings**: Add extension path in Oh My Pi settings

```bash
# Project-level (recommended)
mkdir -p extensions
cp -r plan-exec extensions/

# Or user-level
mkdir -p ~/.omp/extensions
cp -r plan-exec ~/.omp/extensions/
```

## Usage

The LLM can call `plan_exec` with a `code` parameter:

```javascript
async function main(args, task, taskjs) {
  const [frontend, backend] = await Promise.all([
    task('Implement React Button component', componentSchema),
    task('Implement Express /api/button route', routeSchema),
  ])

  const integration = await task(
    `Integrate: ${JSON.stringify({ frontend, backend })}`,
    integrationSchema,
  )

  return { endpoints: [frontend, backend], integration }
}
```

### Using taskjs() — local JS orchestration files

```javascript
// Call a pre-written orchestration module and pass it a goal.
// Import path utilities yourself for cross-platform path joining.

async function main(args, task, taskjs) {
  const { join } = await import('node:path')
  const goal = args?.goal ?? 'Implement the requested feature'

  const result = await taskjs(
    join(GASTOWN_HOME, 'main.js'),
    { goal },
  )

  return result
}
```

Rules:
- Define `async function main(args, task, taskjs)`. `args` is the payload from the caller; `task` and `taskjs` are injected.
- Call `await task(prompt, schema)` to fork LLM sub-agents.
- Call `await taskjs(filePath, args?)` to execute a local JS file that defines `async function main(args, task, taskjs)`.
- **Path resolution**: filePath is resolved relative to the **calling file's directory**, not cwd. Sibling files in the same folder can be referenced by name.
- **GASTOWN_HOME**: environment variable always injected into user code. Use `path.join(GASTOWN_HOME, 'main.js')` or `join(GASTOWN_HOME, 'main.js')` after `await import('node:path')`.
- Return the final result from `main`.

## Operational notes

- Sub-agents inherit the parent session's model, active tools, and context.
- Forked sessions are automatically cleaned up when the task completes or fails.
- User input is broadcast to all running forks so you can steer sub-agents interactively.
- On session shutdown, all active forks are aborted automatically.
- Nested `plan_exec` is supported: a sub-agent may call `plan_exec` again.

## Maintainer spec

See [`SPEC.md`](./SPEC.md) for API contract, error handling, and compatibility rules.

## Test

```bash
npm test
```
