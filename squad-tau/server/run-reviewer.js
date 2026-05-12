import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { buildReviewerPrompt as getReviewerPrompt } from './run-reviewer-prompt.js';
import { REVIEWER_MAX_EMPTY, createCounter } from './empty-turns.js';
import { buildBaseSessionOptions } from './session-options.js';
import { register, unregister, setReturnResolver } from './session-registry.js';
import { subscribeToSessionEvents } from './session-events.js';

function emitSessionEnd(eventBus, sessionId, phase, reason, errorMessage) {
    if (!eventBus || !sessionId) return;
    eventBus.emit('session', 'state', { sessionId, phase });
    eventBus.emit('session', 'end', { sessionId, reason, errorMessage });
}

async function setupReviewerSession({ node, ctx, pi, modelSlot, eventBus, state }) {
    const { SessionManager } = await getCodingAgentModule();
    const options = buildBaseSessionOptions(ctx, pi, modelSlot);
    options.toolNames = ['read', 'search', 'find', 'lsp', 'bash', 'return'];
    const sessionOpts = { ...options, sessionManager: SessionManager.create(options.cwd) };
    const factoryResult = await pi.pi.createAgentSession(sessionOpts);
    const session = factoryResult.session;
    const sessionId = session.sessionFile;
    state.factoryResult = factoryResult;

    register(sessionId, {
        sendUserMessage: (text) => session.prompt(text),
        session,
        status: 'reviewing',
    });

    setReturnResolver(sessionId, (params) => {
        state.settled = true;
        state.outcomeResolve({ approved: params.status === 'ok', reason: params.reason });
    });

    if (eventBus) {
        eventBus.emit('session', 'start', {
            sessionId,
            nodeId: node.id,
            phase: 'reviewer',
            retryCount: state.retryCount,
            model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
        });
        eventBus.emit('session', 'state', { sessionId, phase: 'reviewing' });
        state.unsub = subscribeToSessionEvents(session, eventBus, sessionId);
    }
    return { session, sessionId, factoryResult };
}

async function pollReviewerSettled(session, state, childAbort) {
    const emptyCounter = createCounter(REVIEWER_MAX_EMPTY);
    while (!state.settled) {
        if (childAbort.signal.aborted) break;
        await session.waitForIdle();
        if (state.settled || childAbort.signal.aborted) break;
        emptyCounter.increment();
        if (emptyCounter.exceeded()) {
            throw new Error(`Reviewer ended without calling return after ${REVIEWER_MAX_EMPTY} empty turns`);
        }
        await session.prompt('ERROR: You must call return to finish this review. Do not output prose — call the tool.');
    }
}

async function buildReviewerPrompt(session, node, workerResult, iterationHistory) {
    await session.prompt(getReviewerPrompt({ node, workerResult, iterationHistory: iterationHistory || [] }));
}

async function runReviewer(args) {
    const { node, workerResult, pi, signal, eventBus, iterationHistory } = args;
    if (!pi?.pi?.createAgentSession) throw new Error('squad: createAgentSession unavailable');
    const state = { settled: false, unsub: null };
    const { promise: outcomePromise, resolve: outcomeResolve } = Promise.withResolvers();
    state.outcomeResolve = outcomeResolve;

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
        ({ session, sessionId, factoryResult } = await setupReviewerSession({ ...args, state }));
        await buildReviewerPrompt(session, node, workerResult, iterationHistory);
        await pollReviewerSettled(session, state, childAbort);
        if (!state.settled) return null;

        const outcome = await outcomePromise;
        emitSessionEnd(eventBus, sessionId, 'completed', 'completed');
        return outcome;
    } catch (err) {
        if (childAbort.signal.aborted && signal?.aborted) {
            emitSessionEnd(eventBus, sessionId, 'aborted', 'aborted');
            return null;
        }
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

export { runReviewer };
