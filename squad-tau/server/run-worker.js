import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { buildWorkerPrompt as getWorkerPrompt, buildConfirmPrompt as getConfirmPrompt } from './run-worker-prompt.js';
import { MAX_EMPTY_TURNS, createCounter } from './empty-turns.js';
import { buildWorkerSessionOptions } from './session-options.js';
import { register, unregister, setReturnResolver } from './session-registry.js';
import { subscribeToSessionEvents, emitSessionEnd } from './session-events.js';

function buildWorkerReturnResolver(state) {
    return (params) => {
        if (params.status === 'error') {
            state.redo = true;
            state.redoReason = params.reason || '';
            const resolver = state.phase === 0 ? state.firstResolve : state.finalResolve;
            resolver({ reason: '', affected_files: [], errored: true });
            return;
        }
        if (state.phase === 0) {
            state.phase = 1;
            state.firstResolve({ reason: params.reason, affected_files: params.affected_files || [] });
        } else if (state.phase === 1) {
            state.phase = 2;
            state.finalResolve({ reason: params.reason, affected_files: params.affected_files || [] });
        }
    };
}

async function createWorkerSession(pi, ctx, modelSlot) {
    const { SessionManager } = await getCodingAgentModule();
    const options = buildWorkerSessionOptions(ctx, pi, modelSlot);
    const sessionOpts = { ...options, sessionManager: SessionManager.create(options.cwd) };
    const factoryResult = await pi.pi.createAgentSession(sessionOpts);
    return { session: factoryResult.session, sessionId: factoryResult.session.sessionFile, factoryResult, options };
}

async function setupWorkerSession({ node, ctx, pi, modelSlot, eventBus, state }) {
    const { session, sessionId, factoryResult, options } = await createWorkerSession(pi, ctx, modelSlot);
    state.factoryResult = factoryResult;

    register(sessionId, {
        sendUserMessage: (text) => session.prompt(text),
        session,
        status: 'authoring',
    });

    setReturnResolver(sessionId, buildWorkerReturnResolver(state));

    if (eventBus) {
        state.unsub = emitWorkerSessionStart(eventBus, sessionId, node.id, options, session, state.retryCount);
    }

    return { session, sessionId, factoryResult };
}

function emitWorkerSessionStart(eventBus, sessionId, nodeId, options, session, retryCount) {
    eventBus.emit('session', 'start', {
        sessionId,
        nodeId,
        phase: 'worker',
        retryCount,
        model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
    });
    eventBus.emit('session', 'state', { sessionId, phase: 'authoring' });
    return subscribeToSessionEvents(session, eventBus, sessionId);
}

async function runSessionLoop(session, state, targetPhase, childAbort, emptyCounter, emptyErrorMsg) {
    while (state.phase === targetPhase) {
        if (state.redo) {
            state.redo = false;
            if (targetPhase !== 0) {
                state.phase = 0;
                return;
            }
            await session.prompt(`${state.redoReason}\nContinue working and call return when ready.`);
            continue;
        }
        if (childAbort.signal.aborted) break;
        await session.waitForIdle();
        if (state.phase !== targetPhase || childAbort.signal.aborted) break;
        emptyCounter.increment();
        if (emptyCounter.exceeded()) throw new Error(emptyErrorMsg);
        await session.prompt('ERROR: You must call return to submit your work.');
    }
}

async function handleFirstReturn(session, state, childAbort, emptyCounter) {
    const history = state.iterationHistory || [];
    if (childAbort.signal.aborted) return;
    await session.prompt(getWorkerPrompt(state.node, state.upstreamResults, history));
    await runSessionLoop(
        session,
        state,
        0,
        childAbort,
        emptyCounter,
        `Worker ended without return after ${MAX_EMPTY_TURNS} empty turns`,
    );
    await state.firstPromise;
    if (state.redo) return;
}

async function handleSecondReturn(session, state, childAbort, emptyCounter) {
    if (state.eventBus) state.eventBus.emit('session', 'state', { sessionId: state.sessionId, phase: 'confirming' });
    await session.prompt(getConfirmPrompt(state.node));
    await runSessionLoop(
        session,
        state,
        1,
        childAbort,
        emptyCounter,
        `Self-confirm ended without return after ${MAX_EMPTY_TURNS} empty turns`,
    );
}

function initWorkerState(args) {
    const state = { phase: 0, redo: false, redoReason: '', unsub: null, ...args };
    const { promise: firstPromise, resolve: firstResolve } = Promise.withResolvers();
    const { promise: finalPromise, resolve: finalResolve } = Promise.withResolvers();
    Object.assign(state, { firstPromise, finalPromise, firstResolve, finalResolve });
    return state;
}

function emitWorkerAbortResult(eventBus, sessionId) {
    emitSessionEnd(eventBus, sessionId, 'aborted', 'aborted');
    return null;
}

function isWorkerAborted(childAbort, signal) {
    return childAbort.signal.aborted && signal?.aborted;
}

async function runWorkerLoop(session, state, childAbort, emptyCounter, emitAbort, signal) {
    while (true) {
        await handleFirstReturn(session, state, childAbort, emptyCounter);
        if (isWorkerAborted(childAbort, signal)) return emitAbort();

        await handleSecondReturn(session, state, childAbort, emptyCounter);
        if (isWorkerAborted(childAbort, signal)) return emitAbort();

        // If self-confirm redo reset phase to 0, loop back to worker phase
        if (state.phase === 0) continue;
        break;
    }
}

async function runWorkerBody(session, state, childAbort, emptyCounter, eventBus, signal) {
    const loopResult = await runWorkerLoop(
        session,
        state,
        childAbort,
        emptyCounter,
        () => emitWorkerAbortResult(eventBus, state.sessionId),
        signal,
    );
    if (loopResult !== undefined) return loopResult;

    const finalResult = await state.finalPromise;
    emitSessionEnd(eventBus, state.sessionId, 'completed', 'completed');
    return {
        reason: finalResult.reason,
        affected_files: finalResult.affected_files,
        session,
        sessionFile: session.sessionFile,
    };
}

async function handleWorkerError(err, childAbort, signal, eventBus, sessionId) {
    if (isWorkerAborted(childAbort, signal)) return emitWorkerAbortResult(eventBus, sessionId);
    emitSessionEnd(eventBus, sessionId, 'error', 'error', err.message);
    throw err;
}

function cleanupWorker(childAbort, session, factoryResult, unsub, sessionId) {
    childAbort.abort();
    session?.abort?.();
    factoryResult?.dispose?.();
    unsub?.();
    if (sessionId) unregister(sessionId);
}

async function runWorker(args) {
    const { pi, signal, eventBus } = args;
    if (!pi?.pi?.createAgentSession) throw new Error('squad: createAgentSession unavailable');

    const childAbort = new AbortController();
    const state = initWorkerState(args);

    if (signal)
        signal.addEventListener(
            'abort',
            () => {
                childAbort.abort();
                session?.abort?.();
            },
            { once: true },
        );

    let session = null,
        sessionId = null,
        factoryResult = null;
    try {
        ({ session, sessionId, factoryResult } = await setupWorkerSession({ ...args, state }));
        state.sessionId = sessionId;

        const emptyCounter = createCounter(MAX_EMPTY_TURNS);

        return await runWorkerBody(session, state, childAbort, emptyCounter, eventBus, signal);
    } catch (err) {
        return handleWorkerError(err, childAbort, signal, eventBus, sessionId);
    } finally {
        cleanupWorker(childAbort, session, factoryResult, state.unsub, sessionId);
    }
}

export { runWorker };
