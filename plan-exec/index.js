import { createPlanAndExecuteTool } from './src/tool.js'
import { getActiveForksForSession } from './src/executor.js'
import { generateInitialConfig, saveModelsConfig, getConfigPath } from './src/models-config.js'

const registeredPluginApis = new WeakSet()

function executePlanExecModelsCommand(ctx) {
  const models = generateInitialConfig(ctx?.modelRegistry)
  saveModelsConfig(models)
  const path = getConfigPath()
  return `plan-exec model pool written to ${path} (${models.length} model(s)). Duplicate entries to increase concurrency; remove or edit thinkingLevel as needed.`
}

export default async function planAndExecutePlugin(pi) {
  if (registeredPluginApis.has(pi)) return

  try {
    const tool = await createPlanAndExecuteTool(pi)
    pi.registerTool(tool)

    // Remove built-in task tool before first LLM call — plan_exec replaces it
    let taskDisabled = false
    pi.on('before_agent_start', () => {
      if (taskDisabled) return
      taskDisabled = true
      const active = pi.getActiveTools()
      const filtered = active.filter((t) => t !== 'task')
      if (filtered.length !== active.length) {
        pi.setActiveTools(filtered).catch(() => {})
      }
    })

    // /plan-exec-models — generate initial model pool config
    pi.registerCommand('plan-exec-models', {
      description: 'Generate initial plan-exec model pool config (one entry per available model). Edit ~/.omp/plan-exec/models.json to adjust concurrency.',
      handler: async (_args, ctx) => executePlanExecModelsCommand(ctx),
    })

    // input event handler to intercept /plan-exec-models in chat
    pi.on('input', (event, ctx) => {
      const text = event.text.trim()
      if (text === '/plan-exec-models') {
        executePlanExecModelsCommand(ctx)
        return { handled: true }
      }
      return undefined
    })

    // Broadcast user input to all running task forks
    pi.on('input', (event, ctx) => {
      const sessionId = ctx?.sessionManager?.getSessionId?.()
      if (!sessionId) return undefined

      const forks = getActiveForksForSession(sessionId)
      const running = forks.filter((f) => f.status === 'running' && f.session)
      if (running.length === 0) return undefined

      const text = event.text
      for (const rec of running) {
        try {
          if (rec.session.isStreaming) {
            rec.session.steer(text)
          } else {
            rec.session.prompt(text).catch(() => {})
          }
        } catch (steerErr) {
          // steering failure, continue
        }
      }

      return { handled: true }
    })

    pi.on('session_shutdown', async (_event, ctx) => {
      const sessionId = ctx?.sessionManager?.getSessionId?.()
      if (!sessionId) return
      const forks = getActiveForksForSession(sessionId)
      if (forks.length === 0) return
      for (const fork of forks) {
        try {
          fork.controller?.abort()
        } catch {}
      }
    })

    registeredPluginApis.add(pi)
  } catch (error) {
    registeredPluginApis.delete(pi)
    throw error
  }
}
