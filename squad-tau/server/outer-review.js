import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { OUTER_REVIEW_MAX_EMPTY, createCounter } from './empty-turns.js';
import { buildBaseSessionOptions } from './session-options.js';
import { register, unregister, setReturnResolver } from './session-registry.js';
import { subscribeToSessionEvents, emitSessionEnd } from './session-events.js';

function buildOuterReviewPrompt(originalTask, nodeResults, round) {
    const nodeList = nodeResults
        .map((nr) => {
            const files = nr.affectedFiles?.length ? `, 文件: ${nr.affectedFiles.join(', ')}` : '';
            return `- ${nr.id} (${nr.status}): ${nr.summary}${files}`;
        })
        .join('\n');

    return `你现在是 Squad-Tau 最终审核者，负责评审多节点协作的聚合结果。

原始任务:
${originalTask}

节点结果:
${nodeList}

---
聚合结果是否满足原始任务？
- 满足：return({ status: "ok", reason: "..." })
- 不满足：return({ status: "error", reason: "..." }) 附详细修改意见`;
}

async function runOuterReview(nodeResults, originalTask, round, ctx, pi, signal, eventBus, modelPool) {
    const createAgentSession = pi?.pi?.createAgentSession;
    if (!createAgentSession) throw new Error('squad: createAgentSession unavailable');

    if (eventBus) eventBus.emit('squad', 'outer_review_start', { round });

    const modelSlot = await modelPool.acquire('reviewer', signal);
    try {
        return await executeOuterReviewWithSlot(
            modelSlot,
            modelPool,
            nodeResults,
            originalTask,
            round,
            ctx,
            pi,
            signal,
            eventBus,
            createAgentSession,
        );
    } finally {
        modelPool.release(modelSlot);
    }
}

async function initOuterReviewSession(createAgentSession, sessionOpts, eventBus, round) {
    const factoryResult = await createAgentSession(sessionOpts);
    const session = factoryResult.session;
    const sessionId = session.sessionFile;
    const disposeResult = factoryResult;

    register(sessionId, {
        sendUserMessage: (text) => session.prompt(text),
        session,
        status: 'outer_review',
    });

    let unsub = null;
    if (eventBus) {
        emitSessionStart(eventBus, sessionId, round, sessionOpts);
        unsub = subscribeToSessionEvents(session, eventBus, sessionId);
    }
    return { session, sessionId, unsub, factoryResult };
}

async function executeOuterReviewLoop(session, promptText, childAbort, isSettled, outcomePromise) {
    await session.prompt(promptText);
    await runOuterReviewSessionLoop(session, childAbort, isSettled);

    if (!isSettled()) {
        return null;
    }

    return await outcomePromise;
}

async function prepareReviewSession(nodeResults, originalTask, round, ctx, pi, modelSlot) {
    const { SessionManager } = await getCodingAgentModule();
    const options = buildBaseSessionOptions(ctx, pi, modelSlot);
    options.toolNames = ['read', 'search', 'find', 'lsp', 'bash', 'return'];
    const sessionOpts = { ...options, sessionManager: SessionManager.create(options.cwd) };
    const promptText = buildOuterReviewPrompt(originalTask, nodeResults, round);
    return { sessionOpts, promptText };
}

function emitSessionStart(eventBus, sessionId, round, options) {
    eventBus.emit('session', 'start', {
        sessionId,
        phase: 'outer_review',
        round,
        model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
    });
    eventBus.emit('session', 'state', { sessionId, phase: 'reviewing' });
}

async function runOuterReviewSessionLoop(session, childAbort, isSettled) {
    const emptyCounter = createCounter(OUTER_REVIEW_MAX_EMPTY);
    while (!isSettled()) {
        if (childAbort.signal.aborted) break;
        await session.waitForIdle();
        if (isSettled() || childAbort.signal.aborted) break;

        emptyCounter.increment();
        if (emptyCounter.exceeded()) {
            throw new Error(`Outer review ended without calling return after ${OUTER_REVIEW_MAX_EMPTY} empty turns`);
        }
        await session.prompt('ERROR: You must call return to finish this review. Do not output prose — call the tool.');
    }
}

function processOuterVerdict(eventBus, sessionId, round, outcome) {
    if (eventBus) {
        emitSessionEnd(eventBus, sessionId, 'completed', 'completed');
        eventBus.emit('squad', 'outer_review_result', {
            round,
            verdict: outcome.approved ? 'approved' : 'rejected',
            feedback: outcome.reason,
        });
    }
}

function handleOuterReviewError(err, childAbort, signal, eventBus, sessionId, modelPool, modelSlot) {
    if (childAbort?.signal.aborted && signal?.aborted) {
        emitSessionEnd(eventBus, sessionId, 'aborted', 'aborted');
        modelPool.release(modelSlot);
        return null;
    }
    emitSessionEnd(eventBus, sessionId, 'error', 'error', err.message);
    modelPool.release(modelSlot);
    throw err;
}

function cleanupOuterReview(childAbort, session, unsub, sessionId, factoryResult) {
    childAbort.abort();
    session?.abort?.();
    unsub?.();
    factoryResult?.dispose?.();
    if (sessionId) {
        unregister(sessionId);
    }
}

function createOuterReviewAbortContext(signal) {
    const childAbort = new AbortController();
    const { promise: outcomePromise, resolve: outcomeResolve } = Promise.withResolvers();
    const ctx = { childAbort, settled: false, outcomePromise, outcomeResolve };
    if (signal) {
        signal.addEventListener(
            'abort',
            () => {
                childAbort.abort();
                ctx.session?.abort?.();
            },
            { once: true },
        );
    }
    return ctx;
}

function setupOuterReviewResolver(sessionId, ctx) {
    setReturnResolver(sessionId, (params) => {
        ctx.settled = true;
        ctx.outcomeResolve({ approved: params.status === 'ok', reason: params.reason });
    });
}

async function executeOuterReviewBody(session, childAbort, signal, eventBus, sessionId, round, ctx, promptText) {
    setupOuterReviewResolver(sessionId, ctx);

    const outcome = await executeOuterReviewLoop(
        session,
        promptText,
        childAbort,
        () => ctx.settled,
        ctx.outcomePromise,
    );
    if (!outcome) return null;

    processOuterVerdict(eventBus, sessionId, round, outcome);
    return outcome;
}

async function executeOuterReviewWithSlot(
    modelSlot,
    modelPool,
    nodeResults,
    originalTask,
    round,
    ctx,
    pi,
    signal,
    eventBus,
    createAgentSession,
) {
    const { sessionOpts, promptText } = await prepareReviewSession(
        nodeResults,
        originalTask,
        round,
        ctx,
        pi,
        modelSlot,
    );
    const ac = createOuterReviewAbortContext(signal);

    let session = null,
        unsub = null,
        sessionId = null,
        factoryResult = null;
    ac.session = undefined; // closure placeholder

    try {
        ({ session, sessionId, unsub, factoryResult } = await initOuterReviewSession(
            createAgentSession,
            sessionOpts,
            eventBus,
            round,
        ));
        ac.session = session;

        return await executeOuterReviewBody(session, ac.childAbort, signal, eventBus, sessionId, round, ac, promptText);
    } catch (err) {
        if (ac.childAbort.signal.aborted && signal?.aborted) {
            emitSessionEnd(eventBus, sessionId, 'aborted', 'aborted');
            return null;
        }
        emitSessionEnd(eventBus, sessionId, 'error', 'error', err.message);
        throw err;
    } finally {
        cleanupOuterReview(ac.childAbort, session, unsub, sessionId, factoryResult);
    }
}

function shouldRetry(outcome) {
    return outcome && !outcome.approved;
}

export { runOuterReview, buildOuterReviewPrompt, shouldRetry };
