// executor.js — JS orchestration engine + Fork lifecycle + UI bridging

import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModelsConfig, createModelPool } from './models-config.js'

// ---------------------------------------------------------------------------
// Gastown home — injected into all user code for path resolution
// ---------------------------------------------------------------------------

const _executorDir = dirname(fileURLToPath(import.meta.url))
const _gastownHome = join(_executorDir, '..', 'gastown')
if (!process.env.GASTOWN_HOME) {
  process.env.GASTOWN_HOME = _gastownHome
}

// ---------------------------------------------------------------------------
// Active fork registry
// ---------------------------------------------------------------------------

const activeForksBySessionId = new Map()

export function getActiveForksForSession(sessionId) {
  return activeForksBySessionId.get(sessionId) ?? []
}

function addFork(sessionId, record) {
  if (!activeForksBySessionId.has(sessionId)) {
    activeForksBySessionId.set(sessionId, [])
  }
  activeForksBySessionId.get(sessionId).push(record)
}

function removeFork(sessionId, record) {
  const forks = activeForksBySessionId.get(sessionId)
  if (!forks) return
  const idx = forks.indexOf(record)
  if (idx >= 0) forks.splice(idx, 1)
  if (forks.length === 0) activeForksBySessionId.delete(sessionId)
}

export function abortAllForks(sessionId) {
  const forks = getActiveForksForSession(sessionId)
  for (const fork of forks) {
    try {
      fork.controller?.abort()
    } catch { }
    try {
      fork.session?.abort?.()
    } catch { }
  }
}

// ---------------------------------------------------------------------------
// Return tool — dynamically generated per fork with schema binding
// ---------------------------------------------------------------------------

function buildReturnTool(schema, resolver) {
  return {
    name: 'return',
    label: 'Return',
    description:
      'Submit final result and terminate this task fork. NO RETURN to caller.',
    parameters: {
      type: 'object',
      properties: {
        result: schema ?? {
          type: 'string',
          description: 'Task result (any type)',
        },
      },
      required: ['result'],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, childCtx) {
      resolver(params.result)
      try {
        childCtx?.abort?.()
      } catch { }
      return { content: [], display: false }
    },
  }
}

function getCurrentCodeLineIndex() {
  const stack = new Error().stack || '';
  const lines = stack.split('\n');
  for (const line of lines) {
    if (line.includes('plan-exec-user-code.js:')) {
      const match = line.match(/plan-exec-user-code\.js:(\d+):/);
      if (match) {
        return parseInt(match[1], 10) - 4;
      }
    }
  }
  return -1;
}

function buildProgressPayload(sessionId, codeLines, lineIdx, modelPool) {
  const forks = getActiveForksForSession(sessionId) || [];
  const forkInfos = forks.map((f) => ({
    id: f.id,
    status: f.status,
    model: f.modelKey || 'model',
    lineIdx: f.lineIdx,
    durationMs: Date.now() - f.startedAt,
    tools: f.tools || [],
  }));

  let codeLine = null;
  if (codeLines && lineIdx >= 0 && lineIdx < codeLines.length) {
    codeLine = {
      index: lineIdx,
      line: codeLines[lineIdx],
      prevLine: lineIdx > 0 ? codeLines[lineIdx - 1] : undefined,
      nextLine: lineIdx < codeLines.length - 1 ? codeLines[lineIdx + 1] : undefined,
    };
  }

  return {
    forks: forkInfos,
    codeLine,
    slotUsage: modelPool
      ? { used: modelPool.busyCount, total: modelPool.totalSlots }
      : undefined,
  };
}

function flattenArgs(args) {
  if (!args || typeof args !== 'object') return String(args || '').split('\n')[0]
  return Object.values(args).map(v => {
    if (typeof v === 'object' && v !== null) return flattenArgs(v)
    return String(v).split('\n')[0]
  }).join(' ')
}

function formatNotifyMessage(progress) {
  const { forks, slotUsage } = progress
  const completed = forks.filter(f => f.status === 'completed' || f.status === 'failed')
  const slotInfo = slotUsage ? ` · slot ${slotUsage.used}/${slotUsage.total}` : ''
  const lines = [`Plan & Execute: ${completed.length}/${forks.length} forks done${slotInfo}`]
  for (const f of forks) {
    const isRunning = f.status === 'starting' || f.status === 'running'
    const prefix = isRunning ? '>' : '-'
    const tag = f.model ? `${f.model}#${f.id}` : `#${f.id}`
    const latestTool = f.tools?.[f.tools.length - 1]
    if (latestTool) {
      let argsPreview = ''
      try {
        const args = latestTool.args || {}
        // Content-heavy tools: show path only, avoid flooding terminal with file content
        if (['edit', 'write', 'read'].includes(latestTool.tool) && args.path) {
          argsPreview = String(args.path).slice(0, 60)
        } else {
          argsPreview = flattenArgs(args).slice(0, 40)
        }
      } catch { argsPreview = '' }
      lines.push(`  ${prefix} ${tag} - ${latestTool.tool}: ${argsPreview}`)
    } else {
      const dur = f.durationMs > 1000 ? ` · ${(f.durationMs / 1000).toFixed(1)}s` : ''
      const status = isRunning ? 'running' : 'completed'
      lines.push(`  ${prefix} ${tag} - ${status}${dur}`)
    }
  }
  return lines.join('\n')
}

function emitProgress(ctx, sessionId, onUpdate, codeLines, lineIdx, modelPool) {
  if (!onUpdate) return;
  const progress = buildProgressPayload(sessionId, codeLines, lineIdx, modelPool);
  onUpdate({ content: [], details: { progress } });
  try { ctx?.ui?.notify?.(formatNotifyMessage(progress), 'info') } catch { }
}

// ---------------------------------------------------------------------------
// Session options builder
// ---------------------------------------------------------------------------

function buildSessionOptions(ctx, pi, returnTool, parentDepth, modelOverride) {
  const options = { cwd: ctx?.cwd ?? process.cwd() }

  if (ctx?.modelRegistry) {
    options.modelRegistry = ctx.modelRegistry
  }
  if (modelOverride) {
    const available = ctx?.modelRegistry?.getAvailable?.() ?? []
    const matched = available.find(
      (m) => m.provider === modelOverride.provider && m.id === modelOverride.id,
    )
    if (matched) {
      options.model = matched
      if (modelOverride.thinkingLevel) {
        options.thinkingLevel = modelOverride.thinkingLevel
      }
    }
  }
  if (!options.model && ctx?.model) {
    options.model = ctx.model
  }
  if (!options.thinkingLevel && ctx?.getThinkingLevel) {
    const level = ctx.getThinkingLevel()
    if (level) options.thinkingLevel = level
  }
  if (ctx?.hasUI) {
    options.hasUI = false // child session messages appear directly in chat UI
  }
  if (ctx?.sessionManager?.getSessionId) {
    options.providerSessionId = ctx.sessionManager.getSessionId()
  }
  if (ctx?.getSystemPrompt) {
    const parentPrompt = ctx.getSystemPrompt()
    if (parentPrompt) {
      options.systemPrompt = parentPrompt
    }
  }
  const activeTools = (ctx?.session?.getActiveToolNames?.() ?? pi?.getActiveTools?.())?.filter(
    (t) => t !== 'task',
  )
  if (activeTools?.length > 0) {
    options.toolNames = activeTools
  }
  if (parentDepth !== undefined) {
    options.taskDepth = parentDepth + 1
  }

  const tools = []
  if (returnTool) tools.push(returnTool)
  if (tools.length > 0) options.customTools = tools

  return options
}

// ---------------------------------------------------------------------------
// Fork lifecycle — create child LLM session, run, join, cleanup
// ---------------------------------------------------------------------------

/**
 * Race a prompt call against the abort signal so the fork terminates
 * immediately when the user presses ESC/Ctrl+D, without waiting for
 * the child session to wind down.
 */
async function abortablePrompt(session, text, signal) {
  if (signal?.aborted) {
    throw new Error('Plan execution aborted by user')
  }

  const promptPromise = session.prompt(text)

  const abortPromise = new Promise((_, reject) => {
    const onAbort = () => reject(new Error('Plan execution aborted by user'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  abortPromise.catch(() => { }) // Suppress unhandled rejection from finally-cleanup abort

  await Promise.race([promptPromise, abortPromise])
}

let nextForkId = 0

async function spawnTaskFork(
  prompt,
  schema,
  ctx,
  pi,
  parentSignal,
  onUpdate,
  parentDepth,
  codeLines,
  modelOverride,
  modelPool,
) {
  const createAgentSession = pi?.pi?.createAgentSession

  if (!createAgentSession) {
    throw new Error(
      'plan_exec engine not initialized: createAgentSession unavailable',
    )
  }

  const parentSessionId = ctx?.sessionManager?.getSessionId?.()
  const forkId = ++nextForkId
  let resolved = false
  let parentAborted = false
  let resolver, rejecter

  const resultPromise = new Promise((resolve, reject) => {
    resolver = (val) => {
      if (resolved) return
      resolved = true
      resolve(val)
    }
    rejecter = (err) => {
      if (resolved) return
      resolved = true
      reject(err)
    }
  })

  const childAbort = new AbortController()

  let parentAbortHandler
  if (parentSignal) {
    parentAbortHandler = () => {
      parentAborted = true
      childAbort.abort()
    }
    parentSignal.addEventListener('abort', parentAbortHandler, { once: true })
  }
  const lineIdx = getCurrentCodeLineIndex()

  const forkRecord = {
    id: forkId,
    type: 'llm',
    session: null,
    status: 'starting',
    controller: childAbort,
    startedAt: Date.now(),
    lineIdx,
    modelKey: modelOverride ? modelOverride.id : undefined,
    tools: [],
  }
  addFork(parentSessionId, forkRecord)
  emitProgress(ctx, parentSessionId, onUpdate, codeLines, lineIdx, modelPool)

  let childSession = null
  let unsubscribe = null

  function throwIfAborted() {
    if (!resolved && parentAborted) {
      throw new Error('Parent session aborted')
    }
  }

  try {
    const returnTool = buildReturnTool(schema, resolver)
    const options = buildSessionOptions(ctx, pi, returnTool, parentDepth, modelOverride)

    const factoryResult = await createAgentSession(options)
    if (!factoryResult?.session) {
      throw new Error('createAgentSession returned no session instance')
    }

    childSession = factoryResult.session
    forkRecord.session = childSession
    forkRecord.status = 'running'

    // Subscribe to child session events to capture tool work for display inside the plan_exec box
    if (typeof childSession.subscribe === 'function') {
      unsubscribe = childSession.subscribe((event) => {
        if (!event || !event.type) return
        switch (event.type) {
          case 'tool_execution_start': {
            forkRecord.tools.push({
              tool: event.toolName || event.name || '?',
              args: event.toolArgs || event.args || {},
              startMs: Date.now(),
            })
            break
          }
          case 'tool_execution_end': {
            const last = forkRecord.tools[forkRecord.tools.length - 1]
            if (last && last.tool === event.toolName && !last.endMs) {
              last.endMs = Date.now()
              last.result = event.result
              last.isError = event.isError
            }
            if (forkRecord.tools.length > 20) {
              forkRecord.tools = forkRecord.tools.slice(-20)
            }
            break
          }
        }
        emitProgress(ctx, parentSessionId, onUpdate, codeLines, lineIdx, modelPool)
      })
    }

    emitProgress(ctx, parentSessionId, onUpdate, codeLines, lineIdx, modelPool)

    await abortablePrompt(childSession, prompt, childAbort.signal)
    throwIfAborted()

    let emptyTurnCount = 0
    const MAX_EMPTY_TURNS = 20

    while (!resolved && emptyTurnCount < MAX_EMPTY_TURNS) {
      if (parentAborted) break
      if (childAbort.signal.aborted) break

      while (childSession.isStreaming) {
        await new Promise((r) => setTimeout(r, 200))
        emitProgress(ctx, parentSessionId, onUpdate, codeLines, lineIdx, modelPool)
        if (resolved || parentAborted || childAbort.signal.aborted) break
      }

      if (resolved) break
      if (parentAborted || childAbort.signal.aborted) break

      emptyTurnCount++
      emitProgress(ctx, parentSessionId, onUpdate, codeLines, lineIdx, modelPool)
      await abortablePrompt(
        childSession,
        'ERROR: You must call the `return` tool to submit your result and finish this task. Do not output prose — call the tool.',
        childAbort.signal,
      )
      throwIfAborted()
    }

    throwIfAborted()

    if (!resolved && emptyTurnCount >= MAX_EMPTY_TURNS) {
      rejecter(
        new Error(
          `Task fork exited ${MAX_EMPTY_TURNS} times without calling return`,
        ),
      )
    }

    forkRecord.status = 'completed'
    const result = await resultPromise

    emitProgress(ctx, parentSessionId, onUpdate, codeLines, lineIdx, modelPool)

    return result
  } catch (err) {
    forkRecord.status = 'failed'
    emitProgress(ctx, parentSessionId, onUpdate, codeLines, lineIdx, modelPool)
    throw err
  } finally {
    forkRecord.status = resolved ? 'completed' : 'failed'
    if (parentSignal && parentAbortHandler) {
      parentSignal.removeEventListener('abort', parentAbortHandler)
    }
    // NOTE: do NOT removeFork here — keep completed forks visible in the plan_exec box
    if (unsubscribe) {
      try { unsubscribe() } catch { }
    }
    try {
      childAbort.abort()
    } catch { }
    try {
      childSession?.abort?.()
    } catch { }
  }
}

// ---------------------------------------------------------------------------
// Core execution — runs user JS with injected task()
// ---------------------------------------------------------------------------

async function _executeUserCode(
  code,
  ctx,
  pi,
  signal,
  onUpdate,
  parentDepth,
  codeLines,
  modelPool,
  options = {},
) {
  const userAbort = new AbortController()
  let abortHandler

  if (signal) {
    abortHandler = () => {
      if (!userAbort.signal.aborted) {
        userAbort.abort(signal.reason)
      }
    }
    signal.addEventListener('abort', abortHandler, { once: true })
  }

  // -------------------------------------------------------------------------
  // Console capture — intercept console.* so LLM output doesn't pollute terminal
  // -------------------------------------------------------------------------

  const _consoleBuf = []
  const _consoleOriginals = {}
  const _captureMethods = ['log', 'warn', 'error', 'info', 'debug', 'trace', 'dir']
  for (const _m of _captureMethods) {
    _consoleOriginals[_m] = console[_m]
    console[_m] = (...args) => {
      try {
        const _text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
        _consoleBuf.push(`[${_m}] ${_text}`)
        if (_consoleBuf.length > 500) _consoleBuf.splice(0, _consoleBuf.length - 500)
      } catch {}
    }
  }

  const taskSpawner = async (prompt, schema) => {
    if (userAbort.signal.aborted) {
      throw new Error('Plan execution aborted by user')
    }
    let slot
    if (modelPool) {
      slot = await modelPool.acquire(userAbort.signal)
    }
    try {
      return await spawnTaskFork(
        prompt,
        schema,
        ctx,
        pi,
        userAbort.signal,
        onUpdate,
        parentDepth,
        codeLines,
        slot,
        modelPool,
      )
    } finally {
      slot?.release?.()
    }
  }

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor
    const dirInjection = options?.filePath
      ? `const __dirname = ${JSON.stringify(dirname(options.filePath))};\nconst __filename = ${JSON.stringify(options.filePath)};\n`
      : ''
    const gastownInjection = `const GASTOWN_HOME = ${JSON.stringify(process.env.GASTOWN_HOME)};\n`
    const runner = new AsyncFunction(
      '__task__',
      `"use strict";\n${dirInjection}${gastownInjection}${code}\n;if (typeof main !== 'function') { throw new Error('The provided code must define an async function named "main".'); }\nreturn main(__task__);\n//# sourceURL=plan-exec-user-code.js`
    )

    const result = await runner(taskSpawner)
    return { returnValue: result, _console: _consoleBuf.join('\n') }
  } finally {
    for (const _m of _captureMethods) {
      console[_m] = _consoleOriginals[_m]
    }
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler)
    }
    try { userAbort.abort() } catch { }
  }
}

// ---------------------------------------------------------------------------
// Public execute entry — runs the orchestration code (outermost layer)
// ---------------------------------------------------------------------------

export async function executePlan(code, ctx, pi, signal, onUpdate) {
  if (!pi?.pi?.createAgentSession) {
    throw new Error(
      'plan_exec requires @oh-my-pi/pi-coding-agent but it is not available',
    )
  }

  const codeLines = code.split('\n')
  const sessionId = ctx?.sessionManager?.getSessionId?.()
  const userAbort = new AbortController()

  // Propagate parent abort signal to userAbort
  if (signal) {
    signal.addEventListener('abort', () => {
      if (!userAbort.signal.aborted) {
        userAbort.abort(signal.reason)
      }
    }, { once: true })
  }

  // Load model pool configuration if present
  const modelsConfig = loadModelsConfig()
  const modelPool = createModelPool(modelsConfig)

  // Intercept Escape to abort all forks (only at the outermost layer)
  let unsubTerminalInput
  if (sessionId && typeof ctx?.ui?.onTerminalInput === 'function') {
    unsubTerminalInput = ctx.ui.onTerminalInput((data) => {
      if (data === 'escape' || data === 'esc' || data === 'ctrl+c' || data === 'ctrl+d' || data === 'eof') {
        abortAllForks(sessionId)
        userAbort.abort()
        modelPool?.cancelAll('Plan execution aborted by user')
        return { consume: true }
      }
      return undefined
    })
  }

  try {
    emitProgress(ctx, sessionId, onUpdate, codeLines, -1, modelPool)
    const { returnValue, _console } = await _executeUserCode(
      code,
      ctx,
      pi,
      userAbort.signal,
      onUpdate,
      0,
      codeLines,
      modelPool,
    )
    return { result: returnValue, _console }
  } finally {
    unsubTerminalInput?.()
    modelPool?.cancelAll('Plan execution aborted')
    try { userAbort.abort() } catch { }
  }
}
