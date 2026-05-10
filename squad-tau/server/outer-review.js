import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { createCounter } from './empty-turns.js';
import { buildReviewerTools } from './reviewer-tools.js';
import { buildBaseSessionOptions } from './session-options.js';
import { register, unregister } from './session-registry.js';
import { subscribeToSessionEvents } from './session-events.js';

const OUTER_REVIEW_MAX_EMPTY = 20;

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

If yes, call approve({ comment: "..." }).
If no, call reject({ feedback: "..." }) with specific guidance for the next round.`;
}

async function runOuterReview(nodeResults, originalTask, round, ctx, pi, signal, eventBus, modelPool, startTime) {
    const createAgentSession = pi?.pi?.createAgentSession;
    if (!createAgentSession) {
        throw new Error('squad: createAgentSession unavailable — is the coding-agent loaded?');
    }

    const { SessionManager } = await getCodingAgentModule();

    const modelSlot = await modelPool.acquire('reviewer', signal);

    const options = buildBaseSessionOptions(ctx, pi, modelSlot);
    options.toolNames = ['read', 'search', 'find', 'lsp', 'bash'];

    const promptText = buildOuterReviewPrompt(originalTask, nodeResults, round);

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
            status: 'outer_review',
        });

        if (eventBus) {
            eventBus.emit('session', 'start', {
                sessionId,
                phase: 'outer_review',
                round,
                model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
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
                    `Outer review ended without calling approve/reject after ${OUTER_REVIEW_MAX_EMPTY} empty turns`,
                );
            }

            await session.prompt(
                'ERROR: You must call approve or reject to finish this review. Do not output prose — call the tool.',
            );
        }

        if (!settled) {
            modelPool.release(modelSlot);
            return null;
        }

        const outcome = await outcomePromise;

        if (eventBus) {
            eventBus.emit('session', 'end', {
                sessionId,
                reason: 'completed',
            });
        }

        modelPool.release(modelSlot);
        return outcome;
    } catch (err) {
        if (childAbort.signal.aborted && signal?.aborted) {
            if (eventBus && sessionId) {
                eventBus.emit('session', 'end', {
                    sessionId,
                    reason: 'aborted',
                });
            }
            modelPool.release(modelSlot);
            return null;
        }

        if (eventBus && sessionId) {
            eventBus.emit('session', 'end', {
                sessionId,
                reason: 'error',
                errorMessage: err.message,
            });
        }

        modelPool.release(modelSlot);
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

export { runOuterReview, buildOuterReviewPrompt };
