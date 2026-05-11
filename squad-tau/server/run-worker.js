import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { buildWorkerPrompt } from './run-worker-prompt.js';
import { captureFileSnapshots } from './tamper-detection.js';
import { MAX_EMPTY_TURNS, createCounter } from './empty-turns.js';
import { buildReturnWorkTool } from './lifecycle-tools.js';
import { buildWorkerSessionOptions } from './session-options.js';
import { register, unregister } from './session-registry.js';
import { subscribeToSessionEvents } from './session-events.js';

function emitEnd(eventBus, sessionId, reason, errorMessage) {
    if (!eventBus || !sessionId) return;
    eventBus.emit('session', 'state', { sessionId, phase: reason === 'completed' ? 'completed' : reason });
    eventBus.emit('session', 'end', { sessionId, reason, errorMessage });
}

async function runWorker({ node, upstreamResults, reviewerFeedback, ctx, pi, signal, eventBus, modelSlot }) {
    const createAgentSession = pi?.pi?.createAgentSession;
    if (!createAgentSession) {
        throw new Error('squad: createAgentSession unavailable — is the coding-agent loaded?');
    }

    const { SessionManager } = await getCodingAgentModule();

    const options = buildWorkerSessionOptions(ctx, pi, modelSlot);
    const promptText = buildWorkerPrompt(node, upstreamResults, reviewerFeedback);

    const { promise: firstPromise, resolve: firstResolve } = Promise.withResolvers();
    const { promise: finalPromise, resolve: finalResolve } = Promise.withResolvers();

    let callPhase = 0;
    const returnWorkTool = buildReturnWorkTool((params) => {
        if (callPhase === 0) {
            callPhase = 1;
            firstResolve({ summary: params.summary, affected_files: params.affected_files || [] });
        } else {
            finalResolve({ summary: params.summary, affected_files: params.affected_files || [] });
        }
    });

    const childAbort = new AbortController();
    if (signal) {
        signal.addEventListener('abort', () => childAbort.abort(), { once: true });
    }

    let session = null;
    let unsub = null;
    let sessionId = null;

    try {
        const sessionOpts = {
            ...options,
            customTools: [returnWorkTool],
            sessionManager: SessionManager.create(options.cwd),
        };

        const factoryResult = await createAgentSession(sessionOpts);
        session = factoryResult.session;
        sessionId = session.sessionFile;

        register(sessionId, {
            sendUserMessage: (text) => session.prompt(text),
            session,
            status: 'authoring',
        });

        if (eventBus) {
            eventBus.emit('session', 'start', {
                sessionId,
                nodeId: node.id,
                phase: 'worker',
                model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
            });
            eventBus.emit('session', 'state', { sessionId, phase: 'authoring' });
            unsub = subscribeToSessionEvents(session, eventBus, sessionId);
        }

        // Phase 1: Worker does the work, calls return_work once
        await session.prompt(promptText);

        const emptyCounter = createCounter(MAX_EMPTY_TURNS);
        while (callPhase === 0) {
            if (childAbort.signal.aborted) break;
            while (session.isStreaming) {
                await new Promise((r) => setTimeout(r, 200));
                if (callPhase !== 0 || childAbort.signal.aborted) break;
            }
            if (callPhase !== 0 || childAbort.signal.aborted) break;
            emptyCounter.increment();
            if (emptyCounter.exceeded()) {
                throw new Error(`Worker ended without calling return_work after ${MAX_EMPTY_TURNS} empty turns`);
            }
            await session.prompt('ERROR: You must call return_work to submit your work.');
        }

        if (childAbort.signal.aborted && signal?.aborted) {
            emitEnd(eventBus, sessionId, 'aborted');
            return null;
        }

        const firstResult = await firstPromise;
        const fileSnapshots = await captureFileSnapshots(firstResult.affected_files, options.cwd);

        // Phase 2: Self-confirm — agent reviews and calls return_work again
        if (eventBus) {
            eventBus.emit('session', 'state', { sessionId, phase: 'confirming' });
        }

        const { buildConfirmPrompt } = await import('./run-confirm-prompt.js');
        await session.prompt(buildConfirmPrompt(node.task));

        const confirmCounter = createCounter(MAX_EMPTY_TURNS);
        while (callPhase === 1) {
            if (childAbort.signal.aborted) break;
            while (session.isStreaming) {
                await new Promise((r) => setTimeout(r, 200));
                if (callPhase !== 1 || childAbort.signal.aborted) break;
            }
            if (callPhase !== 1 || childAbort.signal.aborted) break;
            confirmCounter.increment();
            if (confirmCounter.exceeded()) {
                throw new Error(`Self-confirm ended without calling return_work after ${MAX_EMPTY_TURNS} empty turns`);
            }
            await session.prompt(
                'ERROR: You must call return_work to confirm your submission. If changes are needed, make them and call return_work again.',
            );
        }

        if (childAbort.signal.aborted && signal?.aborted) {
            emitEnd(eventBus, sessionId, 'aborted');
            return null;
        }

        const finalResult = await finalPromise;
        const snapshots = await captureFileSnapshots(finalResult.affected_files, options.cwd);

        emitEnd(eventBus, sessionId, 'completed');
        return { ...finalResult, session, sessionFile: session.sessionFile, fileSnapshots: snapshots };
    } catch (err) {
        if (childAbort.signal.aborted && signal?.aborted) {
            emitEnd(eventBus, sessionId, 'aborted');
            return null;
        }
        emitEnd(eventBus, sessionId, 'error', err.message);
        throw err;
    } finally {
        childAbort.abort();
        session?.abort?.();
        unsub?.();
        if (sessionId) unregister(sessionId);
    }
}

export { runWorker };
