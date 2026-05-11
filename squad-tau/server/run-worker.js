import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { buildWorkerPrompt as getWorkerPrompt, buildConfirmPrompt as getConfirmPrompt } from './run-worker-prompt.js';
import { MAX_EMPTY_TURNS, createCounter } from './empty-turns.js';
import { buildWorkerSessionOptions } from './session-options.js';
import { register, unregister, setReturnResolver, clearReturnResolver } from './session-registry.js';
import { subscribeToSessionEvents } from './session-events.js';

function emitEnd(eventBus, sessionId, reason, errorMessage) {
    if (!eventBus || !sessionId) return;
    eventBus.emit('session', 'state', { sessionId, phase: reason === 'completed' ? 'completed' : reason });
    eventBus.emit('session', 'end', { sessionId, reason, errorMessage });
}

async function setupWorkerSession({ node, ctx, pi, modelSlot, eventBus, state }) {
    const { SessionManager } = await getCodingAgentModule();
    const options = buildWorkerSessionOptions(ctx, pi, modelSlot);
    const sessionOpts = { ...options, sessionManager: SessionManager.create(options.cwd) };
    const factoryResult = await pi.pi.createAgentSession(sessionOpts);
    const session = factoryResult.session;
    const sessionId = session.sessionFile;

    register(sessionId, {
        sendUserMessage: (text) => session.prompt(text),
        session,
        status: 'authoring',
    });

    setupWorkerReturnResolver(sessionId, state);

    if (eventBus) {
        state.unsub = emitWorkerSessionStart(eventBus, sessionId, node.id, options, session);
    }

    return { session, sessionId };
}

function setupWorkerReturnResolver(sessionId, state) {
    setReturnResolver(sessionId, (params) => {
        if (params.status === 'error') {
            state.redo = true;
            state.redoReason = params.reason || '';
            return;
        }
        if (state.phase === 0) {
            state.phase = 1;
            state.firstResolve({ reason: params.reason, affected_files: params.affected_files || [] });
        } else {
            state.phase = 2;
            state.finalResolve({ reason: params.reason, affected_files: params.affected_files || [] });
        }
    });
}

function emitWorkerSessionStart(eventBus, sessionId, nodeId, options, session) {
    eventBus.emit('session', 'start', {
        sessionId,
        nodeId,
        phase: 'worker',
        model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
    });
    eventBus.emit('session', 'state', { sessionId, phase: 'authoring' });
    return subscribeToSessionEvents(session, eventBus, sessionId);
}

async function runSessionLoop(session, state, targetPhase, emptyErrorMsg, childAbort) {
    const emptyCounter = createCounter(MAX_EMPTY_TURNS);
    while (state.phase === targetPhase) {
        if (state.redo) {
            state.redo = false;
            if (targetPhase === 1) state.phase = 0;
            await session.prompt(`${state.redoReason}\nContinue working and call return when ready.`);
            if (targetPhase === 1) return; // Exit loop if we reverted to phase 0
            continue;
        }
        if (childAbort.signal.aborted) break;
        while (session.isStreaming) {
            await new Promise((r) => setTimeout(r, 200));
            if (state.phase !== targetPhase || childAbort.signal.aborted) break;
        }
        if (state.phase !== targetPhase || childAbort.signal.aborted) break;
        emptyCounter.increment();
        if (emptyCounter.exceeded()) throw new Error(emptyErrorMsg);
        await session.prompt('ERROR: You must call return to submit your work.');
    }
}

async function handleFirstReturn(session, state, childAbort) {
    const history = state.iterationHistory || [];
    await session.prompt(getWorkerPrompt(state.node, state.upstreamResults, history));
    await runSessionLoop(
        session,
        state,
        0,
        `Worker ended without return after ${MAX_EMPTY_TURNS} empty turns`,
        childAbort,
    );
    await state.firstPromise;
}

async function handleSecondReturn(session, state, childAbort) {
    if (state.eventBus) state.eventBus.emit('session', 'state', { sessionId: state.sessionId, phase: 'confirming' });
    await session.prompt(getConfirmPrompt(state.node));
    await runSessionLoop(
        session,
        state,
        1,
        `Self-confirm ended without return after ${MAX_EMPTY_TURNS} empty turns`,
        childAbort,
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
    if (signal) signal.addEventListener('abort', () => childAbort.abort(), { once: true });

    let session = null,
        sessionId = null;
    try {
        ({ session, sessionId } = await setupWorkerSession({ ...args, state }));
        state.sessionId = sessionId;

        await handleFirstReturn(session, state, childAbort);
        if (childAbort.signal.aborted && signal?.aborted) return (emitEnd(eventBus, sessionId, 'aborted'), null);

        await handleSecondReturn(session, state, childAbort);
        if (childAbort.signal.aborted && signal?.aborted) return (emitEnd(eventBus, sessionId, 'aborted'), null);

        const finalResult = await finalPromise;
        emitEnd(eventBus, sessionId, 'completed');
        return {
            reason: finalResult.reason,
            affected_files: finalResult.affected_files,
            session,
            sessionFile: session.sessionFile,
        };
    } catch (err) {
        if (childAbort.signal.aborted && signal?.aborted) return (emitEnd(eventBus, sessionId, 'aborted'), null);
        emitEnd(eventBus, sessionId, 'error', err.message);
        throw err;
    } finally {
        childAbort.abort();
        session?.abort?.();
        state.unsub?.();
        if (sessionId) {
            clearReturnResolver(sessionId);
            unregister(sessionId);
        }
    }
}

export { runWorker };
