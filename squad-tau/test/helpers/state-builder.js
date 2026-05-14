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
        activeSessionId: n.activeSessionId || null,
        activePhase: n.activePhase || null,
        sessionStatus: n.sessionStatus || 'none',
        lastPromptedPhase: n.lastPromptedPhase || null,
        waitingForModel: n.waitingForModel || null,
    };
}

function buildSessions(nodes, sessionOverrides) {
    const sessions = { ...(sessionOverrides || {}) };
    for (const node of nodes) {
        const sid = node.activeSessionId;
        if (sid && !sessions[sid] && node.activePhase) {
            sessions[sid] = {
                sessionId: sid,
                nodeId: node.id,
                phase: node.activePhase,
                role: node.activePhase,
                status: 'active',
                messages: [],
            };
        }
    }
    return sessions;
}

function buildModelPool(nodes, poolOverrides) {
    const slots = poolOverrides?.slots || [];
    const usage = { ...(poolOverrides?.usage || {}) };
    return { slots, usage, ...poolOverrides };
}

/**
 * Add a return tool call to a session.
 */
export function addReturn(sessionId, sessions, status = 'ok', reason = 'auto', affectedFiles = []) {
    const sess = sessions[sessionId];
    if (!sess) return;
    const params = { status, reason, affected_files: affectedFiles };
    sess.messages.push({
        role: 'assistant',
        messageId: `call-${Date.now()}`,
        content: [
            {
                type: 'tool_call',
                toolName: 'return',
                toolId: `call-${Date.now()}`,
                params,
            },
        ],
    });
    sess.latestReturn = params;
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
 * Auto-wires the sessionId into the node's activeSessionId/activePhase.
 * For outer_review, pass nodeId = null.
 * @returns {string} sessionId
 */
export function createSession(state, nodeId, phase) {
    const prefix = nodeId || 'or';
    const sessionId = `${prefix}-${phase}`;

    if (nodeId) {
        const node = state.squad.nodes.find((n) => n.id === nodeId);
        if (node) {
            node.activeSessionId = sessionId;
            node.activePhase = phase;
            node.sessionStatus = 'active';
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
 * Sets both `messages` and `latestReturn` for O(1) reactor access.
 */
export function giveReturn(state, sessionId, status, reason) {
    const sess = state.sessions[sessionId];
    if (!sess) return;
    const params = { status, reason, affected_files: [] };
    sess.messages.push({
        role: 'assistant',
        messageId: `call-${Date.now()}`,
        content: [
            {
                type: 'tool_call',
                toolName: 'return',
                toolId: `call-${Date.now()}`,
                params,
            },
        ],
    });
    sess.latestReturn = params;
}
