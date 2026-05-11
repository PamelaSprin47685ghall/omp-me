import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { buildWorkerPrompt, buildConfirmPrompt } from './run-worker-prompt.js';
import { MAX_EMPTY_TURNS, createCounter } from './empty-turns.js';
import { buildWorkerSessionOptions } from './session-options.js';
import { register, unregister, setReturnResolver, clearReturnResolver } from './session-registry.js';
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

    let phase = 0;
    let redo = false;
    let redoReason = '';

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

        setReturnResolver(sessionId, (params) => {
            if (params.status === 'error') {
                redo = true;
                redoReason = params.reason || '';
                return;
            }

            if (phase === 0) {
                phase = 1;
                firstResolve({ reason: params.reason, affected_files: params.affected_files || [] });
            } else {
                phase = 2;
                finalResolve({ reason: params.reason, affected_files: params.affected_files || [] });
            }
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

        // Phase 1: Worker does the work, calls return once
        await session.prompt(promptText);

        const emptyCounter = createCounter(MAX_EMPTY_TURNS);
        while (phase === 0) {
            if (redo) {
                redo = false;
                await session.prompt(`Redo requested: ${redoReason}\nContinue working and call return when ready.`);
                continue;
            }
            if (childAbort.signal.aborted) break;
            while (session.isStreaming) {
                await new Promise((r) => setTimeout(r, 200));
                if (phase !== 0 || childAbort.signal.aborted) break;
            }
            if (phase !== 0 || childAbort.signal.aborted) break;
            emptyCounter.increment();
            if (emptyCounter.exceeded()) {
                throw new Error(`Worker ended without calling return after ${MAX_EMPTY_TURNS} empty turns`);
            }
            await session.prompt('ERROR: You must call return to submit your work.');
        }

        if (childAbort.signal.aborted && signal?.aborted) {
            emitEnd(eventBus, sessionId, 'aborted');
            return null;
        }

        await firstPromise;

        // Phase 2: Self-confirm — agent reviews and calls return again
        if (eventBus) {
            eventBus.emit('session', 'state', { sessionId, phase: 'confirming' });
        }

        await session.prompt(buildConfirmPrompt(node));

        const confirmCounter = createCounter(MAX_EMPTY_TURNS);
        while (phase === 1) {
            if (redo) {
                redo = false;
                phase = 0;
                await session.prompt(
                    `Self-review redo requested: ${redoReason}\nContinue working and call return when ready.`,
                );
                continue;
            }
            if (childAbort.signal.aborted) break;
            while (session.isStreaming) {
                await new Promise((r) => setTimeout(r, 200));
                if (phase !== 1 || childAbort.signal.aborted) break;
            }
            if (phase !== 1 || childAbort.signal.aborted) break;
            confirmCounter.increment();
            if (confirmCounter.exceeded()) {
                throw new Error(`Self-confirm ended without calling return after ${MAX_EMPTY_TURNS} empty turns`);
            }
            await session.prompt(
                'ERROR: You must call return to confirm your submission. If changes are needed, make them and call return again.',
            );
        }

        if (childAbort.signal.aborted && signal?.aborted) {
            emitEnd(eventBus, sessionId, 'aborted');
            return null;
        }

        const finalResult = await finalPromise;

        emitEnd(eventBus, sessionId, 'completed');
        return {
            reason: finalResult.reason,
            affected_files: finalResult.affected_files,
            session,
            sessionFile: session.sessionFile,
        };
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
        if (sessionId) {
            clearReturnResolver(sessionId);
            unregister(sessionId);
        }
    }
}

export { runWorker };
