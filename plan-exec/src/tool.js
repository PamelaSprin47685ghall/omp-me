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

function buildGastownSection() {
  const jsModules = [
    'main.js',
    'gastown-orchestrator.js',
    'gastown-dag.js',
    'gastown-gatekeeper.js',
    'gastown-review-loop.js',
    'gastown-tdd-loop.js',
    'gastown-convoy.js',
    'gastown-merge-queue.js',
    'gastown-patrol.js',
    'gastown-molecule.js',
  ]

  const examples = [
    'examples/convoy-example.json',
    'examples/merge-queue-example.json',
    'examples/molecule-example.json',
    'examples/orchestrator-example.json',
    'examples/patrol-example.json',
  ]

  const skills = [
    'skills/convoy-management/README.md',
    'skills/convoy-management/SKILL.md',
    'skills/work-decomposition/README.md',
    'skills/work-decomposition/SKILL.md',
    'skills/merge-queue/README.md',
    'skills/merge-queue/SKILL.md',
    'skills/patrol-monitoring/README.md',
    'skills/patrol-monitoring/SKILL.md',
    'skills/agent-coordination/README.md',
    'skills/agent-coordination/SKILL.md',
    'skills/formula-authoring/README.md',
    'skills/formula-authoring/SKILL.md',
    'skills/issue-tracking/README.md',
    'skills/issue-tracking/SKILL.md',
    'skills/session-management/README.md',
    'skills/session-management/SKILL.md',
  ]

  const agents = [
    'agents/mayor/README.md',
    'agents/mayor/AGENT.md',
    'agents/deacon/README.md',
    'agents/deacon/AGENT.md',
    'agents/refinery/README.md',
    'agents/refinery/AGENT.md',
    'agents/crew-lead/README.md',
    'agents/crew-lead/AGENT.md',
    'agents/polecat/README.md',
    'agents/polecat/AGENT.md',
    'agents/witness/README.md',
    'agents/witness/AGENT.md',
  ]

  const docs = [
    'README.md',
    'references.md',
  ]

  const jsBlocks = jsModules.map((f) =>
    `=== ${f} ===\n${readGastownFile(f)}\n`
  ).join('\n')

  const exampleBlocks = examples.map((f) =>
    `=== ${f} ===\n${readGastownFile(f)}\n`
  ).join('\n')

  const skillBlocks = skills.map((f) =>
    `=== ${f} ===\n${readGastownFile(f)}\n`
  ).join('\n')

  const agentBlocks = agents.map((f) =>
    `=== ${f} ===\n${readGastownFile(f)}\n`
  ).join('\n')

  const docBlocks = docs.map((f) =>
    `=== ${f} ===\n${readGastownFile(f)}\n`
  ).join('\n')

  return [
    '\nPre-built Gas Town orchestration modules (loaded from disk at runtime):\n\n' + jsBlocks,
    '\nExamples:\n\n' + exampleBlocks,
    '\nSkills:\n\n' + skillBlocks,
    '\nAgent role definitions:\n\n' + agentBlocks,
    '\nProtocol docs:\n\n' + docBlocks,
  ].join('\n')
}

function buildToolDescription() {
  const config = loadModelsConfig()
  const maxConcurrency = Array.isArray(config) && config.length > 0 ? config.length : undefined

  const concurrencySection = maxConcurrency
    ? `\nConcurrency:\n• Maximum concurrent forks: ${maxConcurrency}\n• You do NOT need to throttle or batch calls — the runtime handles queuing automatically\n• Prefer natural Promise.all([]) or sequential chains; do not artificially limit parallelism\n• The maximum is for reference only; feel free to submit as many tasks as the plan requires`
    : `\nConcurrency:\n• No model pool configured — concurrent forks are effectively unlimited\n• You do NOT need to throttle or batch calls; the runtime handles any queuing automatically`

  const gastownSection = buildGastownSection()

  return `Write JavaScript to orchestrate complex tasks by forking LLM sub-agents.

Injected signature:
  async function task<T>(prompt: string, schema?: JSONSchema<T>): Promise<T>;

Environment variable GASTOWN_HOME:
• Always available in user code; points to the gastown protocol directory (${process.env.GASTOWN_HOME || '<unknown>'})
• Use it to reference pre-built protocol modules: path.join(GASTOWN_HOME, 'gastown-dag.js'), etc.
• These are reference templates — rewrite main(task) each time you need one.

Rules:
• Write an async function named main that receives task as its only parameter
• Call task(prompt, schema?) to invoke LLM sub-agents with structured output
• Use standard JS control flow (if/for/while/Promise.all/Promise.race)
• task() returns a Promise that resolves when the sub-agent calls its return tool
• Sub-agents inherit the parent session's model, tools, and context
• You MAY nest: a sub-agent can call plan_exec again
• Return the final result from main${concurrencySection}${gastownSection}`
}

const TOOL_PROMPT_SNIPPET =
  'Write an async function named main to orchestrate complex multi-step tasks by forking LLM sub-agents via task(prompt, schema?).'

const TOOL_PROMPT_GUIDELINES = [
  'Use plan_exec when a task naturally breaks into multiple subtasks that can be orchestrated with JS control flow.',
  'Pass a JSON Schema to task() to guarantee structured output from the sub-agent.',
  'Use Promise.all([]) to run independent subtasks in parallel. The runtime automatically queues excess calls if the model pool is exhausted — do not throttle or set timeout manually.',
  'Write an async function named main that receives task as its only parameter and returns the final result.',
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

  return {
    name: 'plan_exec',
    label: 'Plan & Execute',
    description: buildToolDescription(),
    promptSnippet: TOOL_PROMPT_SNIPPET,
    promptGuidelines: TOOL_PROMPT_GUIDELINES,
    parameters: Type.Object({
      code: Type.String({
        description:
          'An async function named main that takes task as its only parameter. Inside the function, use task(prompt, schema) to fork LLM sub-agents with structured output. Use standard JS control flow (if/for/while/Promise.all). The function must return the final result.',
      }),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const start = Date.now()

      try {
        const planResult = await executePlan(params.code, ctx, pi, signal, onUpdate)

        const duration = Date.now() - start
        const { result, _console } = planResult

        const content = [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ]
        if (_console) {
          content.push({
            type: 'text',
            text: `Console output:\n${_console}`,
          })
        }

        return {
          content,
          details: { result, durationMs: duration },
        }
      } catch (err) {
        const duration = Date.now() - start
        const reason = err?.message ?? String(err)
        const _console = err._console || ''
        let errorText = `Plan execution failed after ${duration}ms.\n\nReason: ${reason}`
        if (_console) {
          errorText += `\n\nConsole output:\n${_console}`
        }
        return {
          content: [
            {
              type: 'text',
              text: errorText,
            },
          ],
          details: { error: reason, durationMs: duration },
          isError: true,
        }
      }
    },

    renderResult(result, options, theme) {
      const { isPartial, spinnerFrame } = options
      const progress = result.details?.progress

      // Streaming progress — empty box, content sent via ui.notify
      if (progress && progress.forks) {
        return { render() { return [] } }
      }

      // Final (non-streaming) result
      const duration = result.details?.durationMs ?? 0
      if (result.isError) {
        const reason = result.details?.error ?? 'Unknown error'
        const text = `✖ plan_exec failed after ${duration}ms\n\n${reason}`
        return { render() { return [theme.fg('error', text)] } }
      }
      const text = `✔ plan_exec completed · ${duration}ms`
      return { render() { return [theme.fg('success', text)] } }
    },
  }
}
