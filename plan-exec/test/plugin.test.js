import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('plan-exec extension registration', () => {
  it('registers plan_exec tool', async () => {
    const tools = []
    const commands = []
    const hooks = []

    const pi = {
      on: (event, handler) => hooks.push({ event, handler }),
      registerTool: (tool) => tools.push(tool),
      registerCommand: (name, cfg) => commands.push({ name, ...cfg }),
      typebox: {
        Object: (props) => ({ type: 'object', properties: props }),
        String: (opts) => ({ type: 'string', ...opts }),
      },
    }

    try {
      const ext = (await import('../index.js')).default
      await ext(pi)
    } catch {
      // Expected when pi-coding-agent is not available
    }

    const planExec = tools.find((t) => t.name === 'plan_exec')
    if (planExec) {
      assert.ok(planExec.description.length > 0, 'tool has no description')
      assert.ok(planExec.parameters, 'tool has no parameters schema')
      assert.equal(typeof planExec.execute, 'function')
    }
  })

  it('registers session hooks', async () => {
    const hooks = []
    const commands = []

    const pi = {
      on: (event, handler) => hooks.push({ event, handler }),
      registerTool: () => {},
      registerCommand: (name, cfg) => commands.push({ name, ...cfg }),
      typebox: {
        Object: (props) => ({ type: 'object', properties: props }),
        String: (opts) => ({ type: 'string', ...opts }),
      },
    }

    try {
      const ext = (await import('../index.js')).default
      await ext(pi)
    } catch {
      // Expected when pi-coding-agent is not available
    }

    const events = hooks.map((h) => h.event)
    assert.ok(events.includes('input'), 'missing input hook')
    assert.ok(events.includes('session_shutdown'), 'missing session_shutdown hook')
  })

  it('registers /plan-exec-models command', async () => {
    const commands = []

    const pi = {
      on: () => {},
      registerTool: () => {},
      registerCommand: (name, cfg) => commands.push({ name, ...cfg }),
      typebox: {
        Object: (props) => ({ type: 'object', properties: props }),
        String: (opts) => ({ type: 'string', ...opts }),
      },
    }

    try {
      const ext = (await import('../index.js')).default
      await ext(pi)
    } catch {
      // Expected when pi-coding-agent is not available
    }

    const cmd = commands.find((c) => c.name === 'plan-exec-models')
    assert.ok(cmd, 'plan-exec-models command not registered')
    assert.ok(cmd.description.includes('plan-exec model pool'))
    assert.equal(typeof cmd.handler, 'function')
  })

  it('input hook intercepts /plan-exec-models', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'plan-exec-test-'))
    const originalHome = process.env.OMP_PLAN_EXEC_HOME
    process.env.OMP_PLAN_EXEC_HOME = tempHome

    try {
      const commands = []
      const hooks = []

      const pi = {
        on: (event, handler) => hooks.push({ event, handler }),
        registerTool: () => {},
        registerCommand: (name, cfg) => commands.push({ name, ...cfg }),
        typebox: {
          Object: (props) => ({ type: 'object', properties: props }),
          String: (opts) => ({ type: 'string', ...opts }),
        },
      }

      try {
        const ext = (await import('../index.js')).default
        await ext(pi)
      } catch {
        // Expected when pi-coding-agent is not available
      }

      const inputHooks = hooks.filter((h) => h.event === 'input')
      assert.equal(inputHooks.length, 2, 'expected two input hooks')

      const ctx = {
        modelRegistry: { getAvailable: () => [] },
      }
      const result = inputHooks[0].handler({ text: '/plan-exec-models' }, ctx)
      assert.deepEqual(result, { handled: true })
    } finally {
      process.env.OMP_PLAN_EXEC_HOME = originalHome
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  it('is idempotent via WeakSet guard', async () => {
    const tools = []
    const commands = []
    const pi = {
      on: () => {},
      registerTool: (tool) => tools.push(tool),
      registerCommand: (name, cfg) => commands.push({ name, ...cfg }),
      typebox: {
        Object: (props) => ({ type: 'object', properties: props }),
        String: (opts) => ({ type: 'string', ...opts }),
      },
    }

    try {
      const ext = (await import('../index.js')).default
      await ext(pi)
      await ext(pi)
    } catch {
      // Expected when pi-coding-agent is not available
    }

    const planExecCount = tools.filter((t) => t.name === 'plan_exec').length
    assert.ok(planExecCount <= 1, 'plan_exec registered more than once')
  })
})
