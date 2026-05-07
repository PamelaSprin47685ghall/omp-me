import { chmodSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const OLLAMA_API_BASE = 'https://ollama.com/api'
const ENV_KEY = 'OLLAMA_API_KEY'

function keyFile() {
  return join(process.env.OMP_web_search_HOME || homedir(), '.omp', 'agent', 'ollama.json')
}

let storedKey = ''
let loadedFromFile = false

function loadKeyFromFile() {
  if (loadedFromFile) return
  loadedFromFile = true
  const path = keyFile()
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf-8')
      const data = JSON.parse(raw)
      if (data[ENV_KEY]) storedKey = data[ENV_KEY]
    } catch { /* corrupt file, ignore */ }
  }
}

function resolveKey() {
  if (!storedKey && !process.env[ENV_KEY]) loadKeyFromFile()
  return storedKey || process.env[ENV_KEY] || ''
}

function getApiKey() {
  const key = resolveKey()
  if (!key) throw new Error(`${ENV_KEY} is not set — use \`/ollama-key <key>\` to set it`)
  return key
}

const registeredPluginApis = new WeakSet()

function executeOllamaKeyCommand(args, ctx) {
  const key = args.trim()
  if (!key) {
    ctx.ui.notify('Usage: /ollama-key <your-api-key>', 'info')
    return
  }
  storedKey = key

  try {
    mkdirSync(join(process.env.OMP_web_search_HOME || homedir(), '.omp', 'agent'), { recursive: true })
    writeFileSync(keyFile(), JSON.stringify({ [ENV_KEY]: key }, null, 2), 'utf-8')
    try { chmodSync(keyFile(), 0o600) } catch { /* best-effort permission set */ }
  } catch { /* skip if read-only env */ }

  ctx.ui.notify('Ollama API key saved to ~/.omp/agent/ollama.json', 'success')
}

export default async function ollamaSearchExtension(pi) {
  if (registeredPluginApis.has(pi)) return

  try {
    // ── input event handler to prevent loading animation for /ollama-key ──
    pi.on('input', async (event, ctx) => {
      const text = event.text.trim()
      if (text.startsWith('/ollama-key')) {
        const spaceIndex = text.indexOf(' ')
        const args = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1)
        executeOllamaKeyCommand(args, ctx)
        return { handled: true }
      }
    })

    // ── /ollama-key command ──
    pi.registerCommand('ollama-key', {
      description: 'Set your Ollama API key for Ollama web search. Usage: /ollama-key <key>',
      handler: async (args, ctx) => {
        executeOllamaKeyCommand(args, ctx)
      },
    })

    // ── web_search tool ──
    pi.registerTool({
      name: 'web_search',
      label: 'Ollama Search',
      description:
        'Search the web using Ollama\'s cloud search API (https://ollama.com/api/web_search). ' +
        'Alternative to the built-in web_search tool. Use /ollama-key to set your API key.',
      parameters: pi.typebox.Object({
        query: pi.typebox.String({ description: 'Search query' }),
        max_results: pi.typebox.Optional(
          pi.typebox.Number({ description: 'Maximum number of results (default: 5)' })
        ),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
        const maxResults = params.max_results ?? 5
        const apiKey = getApiKey()

        const response = await fetch(`${OLLAMA_API_BASE}/web_search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ query: params.query, max_results: maxResults }),
          signal,
        })

        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          throw new Error(
            `Ollama web search API error (status ${response.status}): ${errorText || response.statusText}`,
          )
        }

        const data = await response.json()
        const results = data.results ?? []

        const formatted = results
          .map(
            (r, i) =>
              `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content}`,
          )
          .join('\n\n')

        return {
          content: [{ type: 'text', text: formatted || 'No results found.' }],
          details: { results },
        }
      },
    })

    // ── web_fetch tool ──
    pi.registerTool({
      name: 'web_fetch',
      label: 'Ollama Fetch',
      description:
        'Fetch and extract content from a URL using Ollama\'s cloud API (https://ollama.com/api/web_fetch). ' +
        'Use /ollama-key to set your API key.',
      parameters: pi.typebox.Object({
        url: pi.typebox.String({ description: 'URL to fetch' }),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
        const apiKey = getApiKey()

        const response = await fetch(`${OLLAMA_API_BASE}/web_fetch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ url: params.url }),
          signal,
        })

        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          throw new Error(
            `Ollama web fetch API error (status ${response.status}): ${errorText || response.statusText}`,
          )
        }

        const data = await response.json()

        const formatted = [
          `Title: ${data.title}`,
          '',
          'Content:',
          data.content,
          '',
          `Links found: ${data.links?.length ?? 0}`,
          ...(data.links?.slice(0, 10).map((l) => `  - ${l}`) ?? []),
        ].join('\n')

        return {
          content: [{ type: 'text', text: formatted }],
          details: { title: data.title, content: data.content, links: data.links },
        }
      },
    })

    registeredPluginApis.add(pi)
  } catch (error) {
    registeredPluginApis.delete(pi)
    throw error
  }
}
