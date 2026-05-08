# Plan & Execute

Orchestrate complex tasks by writing JavaScript that forks sub-agents with typed return schemas.

Version: `5.1.0`.

## What it provides

| Capability | Name                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| Tool       | `plan_exec` — write JS to fork sub-agents and orchestrate their results |
| Hooks      | `session_start`, `input`, `session_shutdown`                            |

## How it works

The `plan_exec` tool accepts a string of JavaScript code. Your code defines an `async function main(task)` and calls `await task(prompt, schema)` to spawn LLM sub-agents.

- `task()` forks a child LLM session with the same model/tools/context as the parent.
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
async function main(task) {
    const [frontend, backend] = await Promise.all([
        task('Implement React Button component', componentSchema),
        task('Implement Express /api/button route', routeSchema),
    ]);

    const integration = await task(`Integrate: ${JSON.stringify({ frontend, backend })}`, integrationSchema);

    return { endpoints: [frontend, backend], integration };
}
```

### Gas Town 协议模板

`plan-exec/gastown/` 下的 JS 文件是参考性协议模板。每次执行时由 LLM 根据上下文重写 `main(task)`，通过 `task(prompt, schema)` 调用 LLM。

```javascript
async function main(task) {
    const goal = '实现 OAuth2 + JWT 认证系统';
    const result = await task(`编排目标：${goal}`, { type: 'object' });
    return result;
}
```

规则：

- 定义 `async function main(task)`，`task` 是注入的唯一参数
- 调用 `await task(prompt, schema)` 派生 LLM 子代理
- 使用常规 JS 控制流：if/for/while/Promise.all/Promise.race
- 从 `main` 返回最终结果

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
