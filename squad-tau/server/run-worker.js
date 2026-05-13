import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { buildWorkerPrompt as getWorkerPrompt, buildConfirmPrompt as getConfirmPrompt } from './run-worker-prompt.js';
import { MAX_EMPTY_TURNS, createCounter } from './empty-turns.js';
import { buildWorkerSessionOptions } from './session-options.js';
import { register, unregister, setReturnResolver } from './session-registry.js';
import { subscribeToSessionEvents, emitSessionEnd } from './session-events.js';

async function setupWorkerSession({ node, ctx, pi, modelSlot, eventBus, state }) {
    const { SessionManager } = await getCodingAgentModule();
    const options = buildWorkerSessionOptions(ctx, pi, modelSlot);
    const sessionOpts = { ...options, sessionManager: SessionManager.create(options.cwd) };
    const factoryResult = await pi.pi.createAgentSession(sessionOpts);
    const session = factoryResult.session;
    const sessionId = session.sessionFile;
    state.factoryResult = factoryResult;

    register(sessionId, {
        sendUserMessage: (text) => session.prompt(text),
        session,
        status: 'authoring',
    });

    setReturnResolver(sessionId, (params) => {
        if (params.status === 'error') {
            state.redo = true;
            state.redoReason = params.reason || '';
            return;
        }
        if (state.phase === 0) {
            state.phase = 1;
            state.firstResolve({ reason: params.reason, affected_files: params.affected_files || [] });
        } else if (state.phase === 1) {
            state.phase = 2;
            state.finalResolve({ reason: params.reason, affected_files: params.affected_files || [] });
        }
        // Ignore unexpected phase transitions
    });

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

async function runSessionLoop(session, state, targetPhase, emptyErrorMsg, childAbort, emptyCounter) {
    while (state.phase === targetPhase) {
        if (state.redo) {
            state.redo = false;
            if (targetPhase === 1) {
                state.phase = 0;
                return; // return without extra prompt; outer loop re-enters handleFirstReturn
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
        `Worker ended without return after ${MAX_EMPTY_TURNS} empty turns`,
        childAbort,
        emptyCounter,
    );
    await state.firstPromise;
}

async function handleSecondReturn(session, state, childAbort, emptyCounter) {
    if (state.eventBus) state.eventBus.emit('session', 'state', { sessionId: state.sessionId, phase: 'confirming' });
    await session.prompt(getConfirmPrompt(state.node));
    await runSessionLoop(
        session,
        state,
        1,
        `Self-confirm ended without return after ${MAX_EMPTY_TURNS} empty turns`,
        childAbort,
        emptyCounter,
    );
}

async function runWorker(args) {
    const { pi, signal, eventBus } = args;
    if (!pi?.pi?.createAgentSession) throw new Error('squad: createAgentSession unavailable');

    const state = { phase: 0, redo: false, redoReason: '', unsub: null, ...args };
    const { promise: firstPromise, resolve: firstResolve } = Promise.withResolvers();
    const { promise: finalPromise, resolve: finalResolve } = Promise.withResolvers();
    Object.assign(state, { firstPromise, finalPromise, firstResolve, finalResolve });

    const childAbort = new AbortController();
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

        // Outer loop: handle redo from self-confirm (phase 1 redo resets phase to 0)
        while (true) {
            await handleFirstReturn(session, state, childAbort, emptyCounter);
            if (childAbort.signal.aborted && signal?.aborted)
                return (emitSessionEnd(eventBus, sessionId, 'aborted', 'aborted'), null);

            await handleSecondReturn(session, state, childAbort, emptyCounter);
            if (childAbort.signal.aborted && signal?.aborted)
                return (emitSessionEnd(eventBus, sessionId, 'aborted', 'aborted'), null);

            // If self-confirm redo reset phase to 0, loop back to worker phase
            if (state.phase === 0) continue;
            break;
        }

        const finalResult = await finalPromise;
        emitSessionEnd(eventBus, sessionId, 'completed', 'completed');
        return {
            reason: finalResult.reason,
            affected_files: finalResult.affected_files,
            session,
            sessionFile: session.sessionFile,
        };
    } catch (err) {
        if (childAbort.signal.aborted && signal?.aborted)
            return (emitSessionEnd(eventBus, sessionId, 'aborted', 'aborted'), null);
        emitSessionEnd(eventBus, sessionId, 'error', 'error', err.message);
        throw err;
    } finally {
        childAbort.abort();
        session?.abort?.();
        factoryResult?.dispose?.();
        state.unsub?.();
        if (sessionId) {
            unregister(sessionId);
        }
    }
}

export { runWorker };
