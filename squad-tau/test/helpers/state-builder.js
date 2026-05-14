/**
 * State Builder for algebraic tests against reactState().
 *
 * Constructs projected State objects directly without needing
 * to build EventLog arrays. Enables pure algebraic testing:
 *   expect(reactState(buildState({...}))).toEqual([{type, payload}])
 */
import { STATUS } from '../../server/constants.js';

/**
 * Build a minimal state tree with sensible defaults.
 *
 * @param {Object} overrides  — partial state to merge
 * @returns {Object} fully projected state
 */
export function buildState(overrides = {}) {
    const nodes = (overrides.nodes || []).map(normalizeNode);
    const sessions = buildSessions(nodes, overrides.sessions);
    const modelPool = buildModelPool(nodes, overrides.modelPool);

    return {
        squad: {
            status: 'active',
            nodes,
            results: [],
            originalTask: 'test task',
            outerReview: overrides.outerReview || undefined,
            ...overrides.squad,
        },
        sessions,
        modelPool,
    };
}

/**
 * Build a single node with expanded field defaults.
 */
function normalizeNode(n) {
    return {
        id: n.id,
        task: n.task || '',
        review_criteria: n.review_criteria || [],
        depends_on: n.depends_on || [],
        status: n.status || undefined,
        retryCount: n.retryCount || 0,
        summary: n.summary || undefined,
        feedback: n.feedback || undefined,
        affectedFiles: n.affectedFiles || undefined,
        authoringSessionId: n.authoringSessionId || null,
        confirmingSessionId: n.confirmingSessionId || null,
        reviewerSessionId: n.reviewerSessionId || null,
        sessionStatus: n.sessionStatus || 'none',
        lastPromptedPhase: n.lastPromptedPhase || null,
        waitingForModel: n.waitingForModel || null,
    };
}

/**
 * Build sessions dict from nodes and explicit session overrides.
 */
function buildSessions(nodes, sessionOverrides) {
    const sessions = { ...(sessionOverrides || {}) };

    // Auto-build sessions from node sessionIds if not provided
    for (const node of nodes) {
        for (const field of ['authoringSessionId', 'confirmingSessionId', 'reviewerSessionId']) {
            const sid = node[field];
            if (sid && !sessions[sid]) {
                const roleMap = {
                    authoringSessionId: 'worker',
                    confirmingSessionId: 'worker_confirm',
                    reviewerSessionId: 'reviewer',
                };
                sessions[sid] = {
                    sessionId: sid,
                    nodeId: node.id,
                    phase: roleMap[field],
                    role: roleMap[field],
                    status: 'active',
                    messages: [],
                };
            }
        }
    }

    return sessions;
}

/**
 * Build modelPool state from nodes and explicit overrides.
 */
function buildModelPool(nodes, poolOverrides) {
    const slots = poolOverrides?.slots || [];
    const usage = { ...(poolOverrides?.usage || {}) };

    // Auto-build usage from nodes if they have MODEL_POOL_ACQUIRE pattern
    // (usage entries are added explicitly via overrides)

    return {
        slots,
        usage,
        ...poolOverrides,
    };
}

/**
 * Add a return tool call to a session for testing.
 */
export function addReturn(sessionId, sessions, status = 'ok', reason = 'auto', affectedFiles = []) {
    const sess = sessions[sessionId];
    if (!sess) return;
    sess.messages.push({
        role: 'assistant',
        messageId: `call-${Date.now()}`,
        content: [
            {
                type: 'tool_call',
                toolName: 'return',
                toolId: `call-${Date.now()}`,
                params: { status, reason, affected_files: affectedFiles },
            },
        ],
    });
}

/**
 * Convenience: node at a given phase with session.
 */
export function nodeInPhase(id, phase, sessionId, extras = {}) {
    const phaseFieldMap = {
        authoring: 'authoringSessionId',
        confirming: 'confirmingSessionId',
        reviewing: 'reviewerSessionId',
    };
    const roleToPhase = {
        authoring: 'authoring',
        confirming: 'confirming',
        reviewing: 'reviewer',
    };

    const n = {
        id,
        task: extras.task || 'task',
        review_criteria: extras.review_criteria || [],
        depends_on: extras.depends_on || [],
        status:
            phase === 'reviewing'
                ? STATUS.REVIEWING
                : phase === 'confirming'
                  ? STATUS.CONFIRMING
                  : phase === 'authoring'
                    ? STATUS.AUTHORING
                    : phase === 'approved'
                      ? STATUS.APPROVED
                      : phase === 'failed'
                        ? STATUS.FAILED
                        : phase === 'blocked'
                          ? STATUS.BLOCKED
                          : 'idle',
        retryCount: extras.retryCount || 0,
        ...extras,
    };

    if (sessionId && phaseFieldMap[phase]) {
        n[phaseFieldMap[phase]] = sessionId;
        n.sessionStatus = 'active';
    }

    return n;
}
