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
    } catch {}
    try {
      fork.session?.abort?.()
    } catch {}
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
      } catch {}
      return { content: [], display: false }
    },
  }
}

function refreshUI(sessionId, ctx, codeLines, lineIdx, modelPool) {
  const forks = getActiveForksForSession(sessionId) || [];
  const active = forks.filter((f) => f.status === 'starting' || f.status === 'running');

  // Dismiss stale notification when no active forks remain
  if (active.length === 0) {
    ctx?.ui?.notify?.('', 'info');
    return;
  }

  let activeLabel;
  if (modelPool) {
    const labels = active.map((f) => {
      if (f.type === 'js') {
        return `js#${f.id}:${basename(f.filePath || 'unknown')}`
      }
      return `${f.modelKey || 'model'}#${f.id}`
    });
    activeLabel = `[${labels.join(' ')} / ${modelPool.totalSlots}]`;
  } else {
    activeLabel = `[${active.map((f) => `#${f.id}`).join(' ')}]`;
  }

  let snippet = '';
  if (codeLines && lineIdx >= 0 && lineIdx < codeLines.length) {
    const prev = lineIdx > 0 ? `  ${codeLines[lineIdx - 1]}\n` : '';
    const curr = `> ${codeLines[lineIdx]}\n`;
    const next =
      lineIdx < codeLines.length - 1 ? `  ${codeLines[lineIdx + 1]}\n` : '';
    snippet = `\n${prev}${curr}${next}`;
  }
  const msg = `[plan-exec] Active: ${activeLabel}${snippet}`.trimEnd();
  ctx?.ui?.notify?.(msg, 'info');
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
    options.hasUI = ctx.hasUI
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
  const activeTools = ctx?.session?.getActiveToolNames?.() ?? pi?.getActiveTools?.()
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
// File helper — read a JS file for taskjs()
// ---------------------------------------------------------------------------

async function resolveFileCode(filePath, cwd) {
  const { default: fs } = await import('node:fs/promises')
  const { default: path } = await import('node:path')
  const resolved = path.resolve(cwd ?? process.cwd(), filePath)
  const code = await fs.readFile(resolved, 'utf-8')

  return { resolved, code }
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
  abortPromise.catch(() => {}) // Suppress unhandled rejection from finally-cleanup abort

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
  }
  addFork(parentSessionId, forkRecord)

  let childSession = null

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

    refreshUI(parentSessionId, ctx, codeLines, lineIdx, modelPool)

    await abortablePrompt(childSession, prompt, childAbort.signal)
    throwIfAborted()

    let emptyTurnCount = 0
    const MAX_EMPTY_TURNS = 20

    while (!resolved && emptyTurnCount < MAX_EMPTY_TURNS) {
      if (parentAborted) break
      if (childAbort.signal.aborted) break

      while (childSession.isStreaming) {
        await new Promise((r) => setTimeout(r, 200))
        if (resolved || parentAborted || childAbort.signal.aborted) break
      }

      if (resolved) break
      if (parentAborted || childAbort.signal.aborted) break

      emptyTurnCount++
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

    refreshUI(parentSessionId, ctx, codeLines, lineIdx, modelPool)

    return result
  } catch (err) {
    forkRecord.status = 'failed'
    throw err
  } finally {
    forkRecord.status = resolved ? 'completed' : 'failed'
    if (parentSignal && parentAbortHandler) {
      parentSignal.removeEventListener('abort', parentAbortHandler)
    }
    removeFork(parentSessionId, forkRecord)

    try {
      childAbort.abort()
    } catch {}
    try {
      childSession?.abort?.()
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Core execution — runs user JS with injected task() and taskjs()
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
  args = undefined,
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

  const taskjsSpawner = async (filePath, args) => {
    if (userAbort.signal.aborted) {
      throw new Error('Plan execution aborted by user')
    }

    // taskjs(filePath, args) resolves relative to the CALLING file, not cwd.
    // If the calling file is known (via options.filePath), resolve against
    // its directory; otherwise fall back to ctx.cwd. This lets nested
    // orchestration files use sibling paths naturally.
    const { resolved, code: fileCode } = await resolveFileCode(
      filePath,
      options?.filePath ? dirname(options.filePath) : ctx?.cwd,
    )

    const sessionId = ctx?.sessionManager?.getSessionId?.()
    const forkId = ++nextForkId
    const forkRecord = {
      id: forkId,
      type: 'js',
      filePath: resolved,
      status: 'starting',
      controller: null,
      startedAt: Date.now(),
      lineIdx: getCurrentCodeLineIndex(),
    }
    addFork(sessionId, forkRecord)

    const childAbort = new AbortController()
    const childHandler = () => childAbort.abort()
    userAbort.signal.addEventListener('abort', childHandler, { once: true })

    try {
      forkRecord.controller = childAbort
      forkRecord.status = 'running'
      refreshUI(sessionId, ctx, codeLines, forkRecord.lineIdx, modelPool)

      const result = await _executeUserCode(
        fileCode,
        ctx,
        pi,
        childAbort.signal,
        onUpdate,
        (parentDepth ?? 0) + 1,
        codeLines,
        modelPool,
        { filePath: resolved },
        args,
      )

      forkRecord.status = 'completed'
      refreshUI(sessionId, ctx, codeLines, forkRecord.lineIdx, modelPool)
      return result
    } catch (err) {
      forkRecord.status = 'failed'
      throw err
    } finally {
      userAbort.signal.removeEventListener('abort', childHandler)
      try { childAbort.abort() } catch {}
      removeFork(sessionId, forkRecord)
    }
  }

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const dirInjection = options?.filePath
      ? `const __dirname = ${JSON.stringify(dirname(options.filePath))};\nconst __filename = ${JSON.stringify(options.filePath)};\n`
      : ''
    const gastownInjection = `const GASTOWN_HOME = ${JSON.stringify(process.env.GASTOWN_HOME)};\n`
    const runner = new AsyncFunction(
      '__args__',
      '__task__',
      '__taskjs__',
      `"use strict";\n${dirInjection}${gastownInjection}${code}\n;if (typeof main !== 'function') { throw new Error('The provided code must define an async function named "main".'); }\nreturn main(__args__, __task__, __taskjs__);\n//# sourceURL=plan-exec-user-code.js`
    )

    const result = await runner(args, taskSpawner, taskjsSpawner)
    return result
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler)
    }
    try { userAbort.abort() } catch {}
  }
}

// ---------------------------------------------------------------------------
// Public execute entry — runs the orchestration code (outermost layer)
// ---------------------------------------------------------------------------

export async function executePlan(code, ctx, pi, signal, onUpdate, args) {
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

  if (modelPool && ctx?.ui?.notify) {
    ctx.ui.notify(
      `[plan-exec] Concurrency limited to ${modelPool.totalSlots} slot(s) from ~/.omp/plan-exec/models.json`,
      'info',
    )
  }

  // Intercept Escape to abort all forks (only at the outermost layer)
  let unsubTerminalInput
  if (sessionId && typeof ctx?.ui?.onTerminalInput === 'function') {
    unsubTerminalInput = ctx.ui.onTerminalInput((data) => {
      if (data === 'escape' || data === 'esc' || data === 'ctrl+c' || data === 'ctrl+d' || data === 'eof') {
        abortAllForks(sessionId)
        userAbort.abort()
        modelPool?.cancelAll('Plan execution aborted by user')
        ctx?.ui?.notify?.('[plan-exec] Aborted by user', 'info')
        return { consume: true }
      }
      return undefined
    })
  }

  try {
    const result = await _executeUserCode(
      code,
      ctx,
      pi,
      userAbort.signal,
      onUpdate,
      0,
      codeLines,
      modelPool,
      undefined,
      args,
    )
    return result
  } finally {
    unsubTerminalInput?.()
    modelPool?.cancelAll('Plan execution aborted')
    try { userAbort.abort() } catch {}
  }
}
