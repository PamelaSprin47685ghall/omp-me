// tool.js — plan_exec tool definition + dynamic return-schema generation

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { executePlan } from './executor.js'
import { loadModelsConfig } from './models-config.js'

const _toolDir = dirname(fileURLToPath(import.meta.url))
const _gastownHome = join(_toolDir, '..', 'gastown')

function readGastownFile(name) {
  try {
    return readFileSync(join(_gastownHome, name), 'utf-8')
  } catch {
    return `// File not found: ${name}`
  }
}

function readAgentFile(role) {
  try {
    return readFileSync(join(_gastownHome, 'agents', role, 'AGENT.md'), 'utf-8')
  } catch {
    return `// AGENT.md not found for ${role}`
  }
}

function buildGastownSection() {
  const files = [
    'main.js',
    'gastown-orchestrator.js',
    'gastown-convoy.js',
    'gastown-merge-queue.js',
    'gastown-patrol.js',
    'gastown-molecule.js',
  ]

  const roles = ['mayor', 'deacon', 'refinery', 'crew-lead', 'polecat', 'witness']

  const jsBlocks = files.map((f) =>
`=== ${f} ===
${readGastownFile(f)}
`).join('\n')

  const agentBlocks = roles.map((r) =>
`=== agents/${r}/AGENT.md ===
${readAgentFile(r)}
`).join('\n')

  return `\nPre-built Gas Town orchestration modules (loaded from disk at runtime):\n\n${jsBlocks}\nAgent role definitions:\n\n${agentBlocks}`
}

function buildToolDescription() {
  const config = loadModelsConfig()
  const maxConcurrency = Array.isArray(config) && config.length > 0 ? config.length : undefined

  const concurrencySection = maxConcurrency
    ? `\nConcurrency:\n• Maximum concurrent forks: ${maxConcurrency}\n• You do NOT need to throttle or batch calls — the runtime handles queuing automatically\n• Prefer natural Promise.all([]) or sequential chains; do not artificially limit parallelism\n• The maximum is for reference only; feel free to submit as many tasks as the plan requires`
    : `\nConcurrency:\n• No model pool configured — concurrent forks are effectively unlimited\n• You do NOT need to throttle or batch calls; the runtime handles any queuing automatically`

  const gastownSection = buildGastownSection()

  return `Write JavaScript to orchestrate complex tasks by forking sub-agents.

Injected signatures:
  async function task<T>(prompt: string, schema?: JSONSchema<T>): Promise<T>;
  async function taskjs(filePath: string, args?: any): Promise<any>;

Recommended pattern for Gas Town multi-agent orchestration:
  const result = await taskjs(path.join(GASTOWN_HOME, 'main.js'), { goal: 'Implement feature X' })

Environment variable GASTOWN_HOME:
• Always available in user code; points to the gastown orchestration directory (${process.env.GASTOWN_HOME || '<unknown>'})
• Use it to reference pre-built orchestration modules: path.join(GASTOWN_HOME, 'main.js'), path.join(GASTOWN_HOME, 'gastown-convoy.js'), etc.
• Available both in code strings and in taskjs-loaded files
• Use path.join(GASTOWN_HOME, 'agents/mayor/AGENT.md') to load agent role definitions

Path resolution for taskjs():
• filePath is resolved relative to the DIRECTORY of the JS file that calls taskjs()
• Example: in plan-exec/gastown/main.js, taskjs('gastown-convoy.js') resolves to plan-exec/gastown/gastown-convoy.js
• The optional args are passed as the first argument to the called file's main(args, task, taskjs)
• Falls back to cwd only when the calling file path is unknown (top-level code string)

Rules:
• Write an async function named main that receives args, task, and optionally taskjs as its parameters
• The first parameter args is an arbitrary object (or undefined) passed by the caller via taskjs(file, args) or the plan_exec tool
• Call task(...) to fork LLM sub-agents with natural language prompts
• Call taskjs(filePath, args?) to execute a local JS file as a sub-agent (the file must define async function main)
• Use standard JS control flow (if/for/while/Promise.all/Promise.race)
• task() returns a Promise that resolves when the sub-agent calls its return tool
• taskjs() returns a Promise that resolves with the return value of the file's main function
• Sub-agents inherit the parent session's model, tools, and context
• You MAY nest: a sub-agent can call plan_exec again
• Return the final result from main${concurrencySection}${gastownSection}`
}

const TOOL_PROMPT_SNIPPET =
  'Write an async function named main to orchestrate complex multi-step tasks by forking typed sub-agents via task() or local JS files via taskjs().'

const TOOL_PROMPT_GUIDELINES = [
  'Use plan_exec when a task naturally breaks into multiple subtasks that can be orchestrated with JS control flow.',
  'Pass a JSON Schema to task() to guarantee structured output from the sub-agent.',
  'Use taskjs(filePath, args) to execute pre-defined JS orchestration files stored on disk.',
  'Use Promise.all([]) to run independent subtasks in parallel. The runtime automatically queues excess calls if the model pool is exhausted — do not throttle manually.',
  'Write an async function named main that receives args, task, and optionally taskjs as its parameters and returns the final result.',
]

export async function createPlanAndExecuteTool(pi) {
  const [{ Type }] = await Promise.all([
    import('@sinclair/typebox').catch(() => ({
      Type: {
        Object: (properties) => ({ type: 'object', properties }),
        String: (options) => ({ type: 'string', ...options }),
        Optional: (schema) => schema,
      },
    })),
  ])

  const argsSchema = Type.Optional(
    Type.String({
      description:
        'Optional JSON-serialized args object passed as the first argument to main(args, task, taskjs). If omitted, args is undefined.',
    }),
  )

  return {
    name: 'plan_exec',
    label: 'Plan & Execute',
    description: buildToolDescription(),
    promptSnippet: TOOL_PROMPT_SNIPPET,
    promptGuidelines: TOOL_PROMPT_GUIDELINES,
    parameters: Type.Object({
      code: Type.String({
        description:
          'An async function named main that takes args, task, and optionally taskjs as its parameters. Inside the function, use task(prompt, schema) to fork LLM sub-agents or taskjs(filePath, args) to execute local JS files. Use standard JS control flow. The function must return the final result.',
      }),
      args: argsSchema,
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const start = Date.now()

      let parsedArgs
      try {
        if (params.args) {
          parsedArgs = JSON.parse(params.args)
        }
      } catch {
        // If args is not valid JSON, treat it as a plain string
        parsedArgs = params.args
      }

      try {
        const result = await executePlan(params.code, ctx, pi, signal, onUpdate, parsedArgs)

        const duration = Date.now() - start

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          details: { result, durationMs: duration },
        }
      } catch (err) {
        const duration = Date.now() - start
        const reason = err?.message ?? String(err)
        return {
          content: [
            {
              type: 'text',
              text: `Plan execution failed after ${duration}ms.\n\nReason: ${reason}`,
            },
          ],
          details: { error: reason, durationMs: duration },
          isError: true,
        }
      }
    },

    renderResult(result, _options, theme) {
      const duration = result.details?.durationMs ?? 0
      if (result.isError) {
        const reason = result.details?.error ?? 'Unknown error'
        const text = `Plan execution failed after ${duration}ms.\n\nReason: ${reason}`
        return { render() { return [theme.fg('error', text)] } }
      }
      const text = `Plan execution completed in ${duration}ms.`
      return { render() { return [theme.fg('success', text)] } }
    },
  }
}
