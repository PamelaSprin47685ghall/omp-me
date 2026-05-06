import { createPlanAndExecuteTool } from './src/tool.js'
import { getActiveForksForSession } from './src/executor.js'
import { generateInitialConfig, saveModelsConfig, getConfigPath } from './src/models-config.js'

const registeredPluginApis = new WeakSet()

function executePlanExecModelsCommand(ctx) {
  const models = generateInitialConfig(ctx?.modelRegistry)
  saveModelsConfig(models)
  const path = getConfigPath()
  ctx?.ui?.notify?.(
    `plan-exec model pool written to ${path} (${models.length} model(s)). ` +
      'Duplicate entries to increase concurrency; remove or edit thinkingLevel as needed.',
    'info',
  )
}

export default async function planAndExecutePlugin(pi) {
  if (registeredPluginApis.has(pi)) return

  try {
    const tool = await createPlanAndExecuteTool(pi)
    pi.registerTool(tool)

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

      ctx?.ui?.notify?.(
        `[plan-exec] Steering user input to ${running.length} running fork(s): ${running.map((f) => `#${f.id}`).join(', ')}`,
        'info',
      )

      const text = event.text
      for (const rec of running) {
        try {
          if (rec.session.isStreaming) {
            rec.session.steer(text)
          } else {
            rec.session.prompt(text).catch(() => {})
          }
        } catch (steerErr) {
          ctx?.ui?.notify?.(
            `[plan-exec] Failed to steer to fork #${rec.id}: ${steerErr.message}`,
            'warning',
          )
        }
      }

      return { handled: true }
    })

    pi.on('session_shutdown', async (_event, ctx) => {
      const sessionId = ctx?.sessionManager?.getSessionId?.()
      if (!sessionId) return
      const forks = getActiveForksForSession(sessionId)
      if (forks.length === 0) return
      ctx?.ui?.notify?.(
        `[plan-exec] Aborting ${forks.length} active task fork(s) on session shutdown`,
        'info',
      )
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
