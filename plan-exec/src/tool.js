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
        const result = await executePlan(params.code, ctx, pi, signal, onUpdate)

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

    renderResult(result, options, theme) {
      const { isPartial, spinnerFrame } = options
      const progress = result.details?.progress

      // Streaming progress — render fork tree
      if (progress && progress.forks) {
        let cached
        return {
          render(width) {
            const key = `${isPartial}:${spinnerFrame ?? 0}:${width}`
            if (cached?.key === key) return cached.lines

            const lines = []
            const { forks, codeLine, slotUsage } = progress
            const completed = forks.filter(f => f.status === 'completed' || f.status === 'failed')
            const active = forks.filter(f => f.status === 'starting' || f.status === 'running')
            const slotInfo = slotUsage ? ` · slot ${slotUsage.used}/${slotUsage.total}` : ''
            const spinner = active.length > 0 ? theme.status.running + ' ' : ''
            const header = `${spinner}plan_exec · ${completed.length}/${forks.length} done${slotInfo}`
            lines.push(theme.fg('accent', header))

            for (let i = 0; i < forks.length; i++) {
              const f = forks[i]
              const isLast = i === forks.length - 1
              const treePre = theme.fg('dim', isLast ? theme.tree.last : theme.tree.branch)
              const contPre = isLast ? '   ' : `${theme.fg('dim', theme.tree.vertical)}  `

              let icon, color
              switch (f.status) {
                case 'completed':
                  icon = theme.status.success; color = 'success'; break
                case 'failed':
                case 'aborted':
                  icon = theme.status.error; color = 'error'; break
                default:
                  icon = theme.status.running; color = 'accent'
              }

              const tag = `${f.model}#${f.id}`
              const dur = f.durationMs > 1000 ? ` · ${(f.durationMs / 1000).toFixed(1)}s` : ''
              lines.push(` ${treePre} ${theme.fg(color, icon)} ${theme.fg('accent', tag)}${dur}`)

              // Render recent tools for this fork
              if (f.tools && f.tools.length > 0) {
                for (const t of f.tools.slice(-3)) {
                  const toolDur = t.endMs && t.startMs ? ` · ${((t.endMs - t.startMs) / 1000).toFixed(1)}s` : ''
                  const toolIcon = t.isError ? theme.status.error : (t.endMs ? theme.status.success : theme.status.running)
                  let argsPreview = ''
                  try { argsPreview = JSON.stringify(t.args || {}).slice(0, 36) } catch { argsPreview = '{}' }
                  const toolLine = `${t.tool}${argsPreview}${toolDur}`
                  lines.push(` ${contPre} ${theme.fg('dim', toolIcon)} ${theme.fg('dim', toolLine)}`)
                }
              }

              // Code line snippet under each fork
              if (codeLine && f.lineIdx >= 0 && f.lineIdx === codeLine.index) {
                const maxLen = Math.max(width - 8, 24)
                const raw = `${codeLine.index + 1}:  ${codeLine.line}`
                const display = raw.length > maxLen ? raw.slice(0, maxLen - 1) + '…' : raw
                lines.push(` ${contPre} ${theme.fg('dim', display)}`)
              }
            }

            cached = { key, lines }
            return lines
          },
          invalidate() { cached = undefined },
        }
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
