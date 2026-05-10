import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { buildWorkerPrompt } from './run-worker-prompt.js';
import { captureFileSnapshots } from './tamper-detection.js';
import { MAX_EMPTY_TURNS, createCounter } from './empty-turns.js';
import { buildReturnWorkTool } from './lifecycle-tools.js';
import { buildWorkerSessionOptions } from './session-options.js';
import { register, unregister } from './session-registry.js';
import { subscribeToSessionEvents } from './session-events.js';

function emitSessionEnd(eventBus, sessionId, phase, reason, errorMessage) {
    if (!eventBus || !sessionId) return;
    eventBus.emit('session', 'state', { sessionId, phase });
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

    const { promise: workPromise, resolve: workResolve } = Promise.withResolvers();

    const childAbort = new AbortController();
    let settled = false;

    const returnWorkTool = buildReturnWorkTool((result) => {
        settled = true;
        workResolve(result);
    });

    if (signal) {
        signal.addEventListener(
            'abort',
            () => {
                childAbort.abort();
            },
            { once: true },
        );
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
            eventBus.emit('session', 'state', {
                sessionId,
                phase: 'authoring',
            });

            unsub = subscribeToSessionEvents(session, eventBus, sessionId);
        }

        await session.prompt(promptText);

        const emptyCounter = createCounter(MAX_EMPTY_TURNS);

        while (!settled) {
            if (childAbort.signal.aborted) break;

            while (session.isStreaming) {
                await new Promise((r) => setTimeout(r, 200));
                if (settled || childAbort.signal.aborted) break;
            }

            if (settled || childAbort.signal.aborted) break;

            emptyCounter.increment();
            if (emptyCounter.exceeded()) {
                throw new Error(`Worker ended without calling return_work after ${MAX_EMPTY_TURNS} empty turns`);
            }

            await session.prompt(
                'ERROR: You must call the required tool to finish this session. Do not output prose — call the tool.',
            );
        }

        if (!settled) {
            return null;
        }

        const workerResult = await workPromise;

        const snapshots = await captureFileSnapshots(workerResult.affected_files || [], options.cwd);

        emitSessionEnd(eventBus, sessionId, 'completed', 'completed');

        return {
            ...workerResult,
            sessionFile: session.sessionFile,
            session,
            fileSnapshots: snapshots,
        };
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
        unsub?.();
        if (sessionId) {
            unregister(sessionId);
        }
    }
}

export { runWorker };
