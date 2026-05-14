/**
 * State Builder + Algebraic Test DSL.
 *
 * Two modes:
 *   1. buildState({...}) — explicit construction for full control
 *   2. DSL: createBaseState() + mutators — fluent algebraic testing
 *
 * Both produce projected State trees for pure-function reactor tests:
 *   expect(reactState(state)).toEqual([{type, payload}])
 */
import { STATUS } from '../../server/constants.js';

// ════════════════════════════════════════════════════════════════════
// EVENT-LOG UTILITIES (for integration/engine-loop tests)
// ════════════════════════════════════════════════════════════════════

/**
 * Create a minimal EventLog-compatible array.
 * Auto-incrementing ids, pure in-memory.
 */
export function makeEventLog() {
    const a = [];
    let i = 0;
    return {
        append(e, p) {
            const o = { id: i++, event: e, payload: p };
            a.push(o);
            return o;
        },
        getSince(n = 0) {
            return a.slice(n);
        },
        all() {
            return a;
        },
        last() {
            return a[a.length - 1];
        },
    };
}

/** Append every reactor action back into the event log. */
export function appendAll(log, events) {
    for (const e of events) log.append(e.type, e.payload);
}

// ════════════════════════════════════════════════════════════════════
// STATE CONSTRUCTION (low-level)
// ════════════════════════════════════════════════════════════════════

/**
 * Build a projected state tree with sensible defaults.
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

function buildSessions(nodes, sessionOverrides) {
    const sessions = { ...(sessionOverrides || {}) };
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

function buildModelPool(nodes, poolOverrides) {
    const slots = poolOverrides?.slots || [];
    const usage = { ...(poolOverrides?.usage || {}) };
    return { slots, usage, ...poolOverrides };
}

// ════════════════════════════════════════════════════════════════════
// FORWARD COMPAT: legacy helpers used by integration tests
// ════════════════════════════════════════════════════════════════════

/**
 * Add a return tool call to a session.
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
 * Build a node descriptor at a given phase with session wiring.
 * @deprecated Use the DSL mutators instead.
 */
export function nodeInPhase(id, phase, sessionId, extras = {}) {
    const phaseFieldMap = {
        authoring: 'authoringSessionId',
        confirming: 'confirmingSessionId',
        reviewing: 'reviewerSessionId',
    };

    const n = {
        id,
        task: extras.task || 'task',
        review_criteria: extras.review_criteria || [],
        depends_on: extras.depends_on || [],
        status:
            {
                reviewing: STATUS.REVIEWING,
                confirming: STATUS.CONFIRMING,
                authoring: STATUS.AUTHORING,
                approved: STATUS.APPROVED,
                failed: STATUS.FAILED,
                blocked: STATUS.BLOCKED,
            }[phase] || 'idle',
        retryCount: extras.retryCount || 0,
        ...extras,
    };

    if (sessionId && phaseFieldMap[phase]) {
        n[phaseFieldMap[phase]] = sessionId;
        n.sessionStatus = 'active';
    }

    return n;
}

// ════════════════════════════════════════════════════════════════════
// ALGEBRAIC TEST DSL
// ════════════════════════════════════════════════════════════════════

/**
 * Create a minimal projected state ready for algebraic testing.
 * Each argument is a node definition (string → simple ID, or object with deps/task).
 *
 * @example
 *   createBaseState('A', 'B')            // 2 independent nodes, L mode
 *   createBaseState({ id: 'A' }, { id: 'B', deps: ['A'] })  // chain
 */
export function createBaseState(...nodeDefs) {
    const nodes =
        nodeDefs.length > 0
            ? nodeDefs.map((d) => (typeof d === 'string' ? { id: d, task: 'task', review_criteria: [] } : d))
            : [{ id: 'n1', task: 'task', review_criteria: [] }];

    return buildState({ nodes });
}

/**
 * Set a node's status and optional extra fields.
 * Shallow merge — does NOT auto-clear session references (caller controls sessions).
 */
export function setStatus(state, nodeId, status, extra = {}) {
    const node = state.squad.nodes.find((n) => n.id === nodeId);
    if (node) Object.assign(node, { status, ...extra });
}

/**
 * Create a session linked to a node at a given phase.
 * Auto-wires the sessionId into the node's phase field (authoringSessionId/confirmingSessionId/reviewerSessionId).
 * For outer_review, pass nodeId = null.
 * @returns {string} sessionId
 */
export function createSession(state, nodeId, phase) {
    const prefix = nodeId || 'or';
    const sessionId = `${prefix}-${phase}`;

    if (nodeId) {
        const node = state.squad.nodes.find((n) => n.id === nodeId);
        if (node) {
            const fieldMap = {
                worker: 'authoringSessionId',
                worker_confirm: 'confirmingSessionId',
                reviewer: 'reviewerSessionId',
            };
            if (fieldMap[phase]) {
                node[fieldMap[phase]] = sessionId;
                node.sessionStatus = 'active';
            }
        }
    }

    state.sessions[sessionId] = {
        sessionId,
        nodeId,
        phase,
        role: phase,
        status: 'active',
        messages: [],
    };

    return sessionId;
}

/**
 * Add a model slot to the pool.
 * If slotDef.slotId is omitted, auto-generates one.
 * @returns {string} slotId
 */
export function addSlot(state, slotDef = {}) {
    const slotId = slotDef.slotId || `slot-${state.modelPool.slots.length}-${slotDef.role || 'worker'}`;
    state.modelPool.slots.push({ slotId, role: 'worker', provider: 'test', modelId: 'default', ...slotDef, slotId });
    return slotId;
}

/**
 * Replace all model pool slots.
 */
export function setSlots(state, slots) {
    state.modelPool.slots = slots;
}

/**
 * Mark a model as acquired for a node+role.
 * If slotId is omitted, assigns the first free slot matching the role.
 * @returns {string} slotId
 */
export function acquireModel(state, nodeId, role, slotId) {
    if (!slotId) {
        const free = state.modelPool.slots.find((s) => s.role === role && !state.modelPool.usage[s.slotId]);
        slotId = free?.slotId || `slot-${role}-auto`;
    }
    state.modelPool.usage[slotId] = { inUse: true, holder: nodeId, nodeId, role };
    return slotId;
}

/**
 * Inject a 'return' tool_call into a session's message history.
 * Shortcut for the common pattern: session gets a `return { status, reason }`.
 */
export function giveReturn(state, sessionId, status, reason) {
    const sess = state.sessions[sessionId];
    if (!sess) return;
    sess.messages.push({
        role: 'assistant',
        messageId: `call-${Date.now()}`,
        content: [
            {
                type: 'tool_call',
                toolName: 'return',
                toolId: `call-${Date.now()}`,
                params: { status, reason, affected_files: [] },
            },
        ],
    });
}
