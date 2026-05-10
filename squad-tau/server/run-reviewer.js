import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { buildReviewerPrompt } from './run-reviewer-prompt.js';
import { REVIEWER_MAX_EMPTY, createCounter } from './empty-turns.js';
import { buildReviewerTools } from './reviewer-tools.js';
import { buildBaseSessionOptions } from './session-options.js';
import { register, unregister } from './session-registry.js';
import { subscribeToSessionEvents } from './session-events.js';

function emitSessionEnd(eventBus, sessionId, phase, reason, errorMessage) {
    if (!eventBus || !sessionId) return;
    eventBus.emit('session', 'state', { sessionId, phase });
    eventBus.emit('session', 'end', { sessionId, reason, errorMessage });
}

async function runReviewer({ node, workerResult, ctx, pi, signal, eventBus, modelSlot }) {
    const createAgentSession = pi?.pi?.createAgentSession;
    if (!createAgentSession) {
        throw new Error('squad: createAgentSession unavailable — is the coding-agent loaded?');
    }

    const { SessionManager } = await getCodingAgentModule();

    const options = buildBaseSessionOptions(ctx, pi, modelSlot);
    options.toolNames = ['read', 'search', 'find', 'lsp', 'bash'];

    const promptText = buildReviewerPrompt({ node, workerResult });

    const { promise: outcomePromise, resolve: outcomeResolve } = Promise.withResolvers();

    const childAbort = new AbortController();
    let settled = false;

    const reviewerTools = buildReviewerTools(outcomeResolve, (value) => {
        settled = value;
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
            customTools: reviewerTools,
            sessionManager: SessionManager.create(options.cwd),
        };

        const factoryResult = await createAgentSession(sessionOpts);
        session = factoryResult.session;
        sessionId = session.sessionFile;

        register(sessionId, {
            sendUserMessage: (text) => session.prompt(text),
            session,
            status: 'reviewing',
        });

        if (eventBus) {
            eventBus.emit('session', 'start', {
                sessionId,
                nodeId: node.id,
                phase: 'reviewer',
                model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
            });
            eventBus.emit('session', 'state', {
                sessionId,
                phase: 'reviewing',
            });

            unsub = subscribeToSessionEvents(session, eventBus, sessionId);
        }

        await session.prompt(promptText);

        const emptyCounter = createCounter(REVIEWER_MAX_EMPTY);

        while (!settled) {
            if (childAbort.signal.aborted) break;

            while (session.isStreaming) {
                await new Promise((r) => setTimeout(r, 200));
                if (settled || childAbort.signal.aborted) break;
            }

            if (settled || childAbort.signal.aborted) break;

            emptyCounter.increment();
            if (emptyCounter.exceeded()) {
                throw new Error(
                    `Reviewer ended without calling approve/reject after ${REVIEWER_MAX_EMPTY} empty turns`,
                );
            }

            await session.prompt(
                'ERROR: You must call approve or reject to finish this review. Do not output prose — call the tool.',
            );
        }

        if (!settled) {
            return null;
        }

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
        unsub?.();
        if (sessionId) {
            unregister(sessionId);
        }
    }
}

export { runReviewer };
