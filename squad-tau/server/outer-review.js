import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { OUTER_REVIEW_MAX_EMPTY, createCounter } from './empty-turns.js';
import { buildBaseSessionOptions } from './session-options.js';
import { register, unregister, setReturnResolver, clearReturnResolver } from './session-registry.js';
import { subscribeToSessionEvents } from './session-events.js';

function buildOuterReviewPrompt(originalTask, nodeResults, round) {
    const nodeList = nodeResults
        .map((nr) => {
            const files = nr.affectedFiles?.length ? nr.affectedFiles.join(', ') : 'none';
            return `- Node ${nr.id} (${nr.status}): ${nr.summary}\n  Affected files: ${files}`;
        })
        .join('\n');

    return `You are reviewing the aggregated results of a multi-node squad execution (round ${round}).

Original task:
${originalTask}

Node results:
${nodeList}

Does the aggregated result satisfy the original task?

If yes, call return({ status: 'ok', reason: '...' }).
If no, call return({ status: 'error', reason: '...' }) with specific guidance for the next round.`;
}

function emitSessionEnd(eventBus, sessionId, phase, reason, errorMessage) {
    if (!eventBus || !sessionId) return;
    eventBus.emit('session', 'state', { sessionId, phase });
    eventBus.emit('session', 'end', { sessionId, reason, errorMessage });
}

async function runOuterReview(nodeResults, originalTask, round, ctx, pi, signal, eventBus, modelPool, startTime) {
    const createAgentSession = pi?.pi?.createAgentSession;
    if (!createAgentSession) {
        throw new Error('squad: createAgentSession unavailable — is the coding-agent loaded?');
    }

    const { SessionManager } = await getCodingAgentModule();

    if (eventBus) {
        eventBus.emit('squad', 'outer_review_start', { round });
    }

    const modelSlot = await modelPool.acquire('reviewer', signal);

    const options = buildBaseSessionOptions(ctx, pi, modelSlot);
    options.toolNames = ['read', 'search', 'find', 'lsp', 'bash'];

    const promptText = buildOuterReviewPrompt(originalTask, nodeResults, round);

    const { promise: outcomePromise, resolve: outcomeResolve } = Promise.withResolvers();

    const childAbort = new AbortController();
    let settled = false;

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
            sessionManager: SessionManager.create(options.cwd),
        };

        const factoryResult = await createAgentSession(sessionOpts);
        session = factoryResult.session;
        sessionId = session.sessionFile;

        register(sessionId, {
            sendUserMessage: (text) => session.prompt(text),
            session,
            status: 'outer_review',
        });

        setReturnResolver(sessionId, (params) => {
            settled = true;
            outcomeResolve({ approved: params.status === 'ok', reason: params.reason });
        });

        if (eventBus) {
            eventBus.emit('session', 'start', {
                sessionId,
                phase: 'outer_review',
                round,
                model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
            });
            eventBus.emit('session', 'state', {
                sessionId,
                phase: 'reviewing',
            });

            unsub = subscribeToSessionEvents(session, eventBus, sessionId);
        }

        await session.prompt(promptText);

        const emptyCounter = createCounter(OUTER_REVIEW_MAX_EMPTY);

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
                    `Outer review ended without calling return after ${OUTER_REVIEW_MAX_EMPTY} empty turns`,
                );
            }

            await session.prompt(
                'ERROR: You must call return to finish this review. Do not output prose — call the tool.',
            );
        }

        if (!settled) {
            modelPool.release(modelSlot);
            return null;
        }

        const outcome = await outcomePromise;

        if (eventBus) {
            emitSessionEnd(eventBus, sessionId, 'completed', 'completed');
            eventBus.emit('squad', 'outer_review_result', {
                round,
                verdict: outcome.approved ? 'approved' : 'rejected',
                feedback: outcome.reason,
            });
        }

        modelPool.release(modelSlot);
        return outcome;
    } catch (err) {
        if (childAbort.signal.aborted && signal?.aborted) {
            emitSessionEnd(eventBus, sessionId, 'aborted', 'aborted');
            modelPool.release(modelSlot);
            return null;
        }

        emitSessionEnd(eventBus, sessionId, 'error', 'error', err.message);
        modelPool.release(modelSlot);
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

export { runOuterReview, buildOuterReviewPrompt };
