/** Compact console widget for squad node progress — comma-separated, single-line. */

// Each status gets a distinct glyph for at-a-glance identification.
const SYM = Object.freeze({
    waiting_deps: '\u23F3', // hourglass — waiting for deps
    pending: '\u25CB', // empty circle — queued
    authoring: '\u270E', // pencil — actively writing
    confirming: '\u21BB', // clockwise arrow — verification in progress
    reviewing: '\u25CE', // bullseye — under review
    approved: '\u2713', // check — passed
    rejected: '\u2717', // ballot X — needs retry
    blocked: '\u26A0', // warning — blocked by failure
    failed: '\u2716', // heavy X — unrecoverable
});

function buildSegment(n, nodeMap) {
    const sym = SYM[n.status] || '?';
    let seg = `${n.id}${sym}`;
    if (n.retryCount > 0 && (n.status === 'authoring' || n.status === 'confirming' || n.status === 'reviewing')) {
        seg += `#${n.retryCount}`;
    }
    if (n.status === 'waiting_deps') {
        const pending = n.deps.filter((d) => {
            const dep = nodeMap.get(d);
            return dep && dep.status !== 'approved';
        });
        if (pending.length > 0 && pending.length <= 2) {
            seg += `[${pending.join(',')}]`;
        }
    }
    return seg;
}

function buildConsoleLine(nodeMap) {
    const parts = [];
    for (const n of nodeMap.values()) {
        parts.push(buildSegment(n, nodeMap));
    }
    const done = [...nodeMap.values()].filter((n) => n.status === 'approved').length;
    const total = nodeMap.size;
    return done === total ? `squad: \u2713 ${done}/${total}` : `squad: ${parts.join(', ')}`;
}

function applyInit(nodeMap, payload) {
    nodeMap.clear();
    for (const n of payload.nodes) {
        nodeMap.set(n.id, {
            id: n.id,
            status: n.depends_on?.length ? 'waiting_deps' : 'pending',
            retryCount: 0,
            deps: n.depends_on || [],
        });
    }
}

function applyNodeState(nodeMap, payload) {
    const n = nodeMap.get(payload.nodeId);
    if (!n) return;
    n.status = payload.status;
    if (payload.retryCount !== undefined) n.retryCount = payload.retryCount;
}

export function createViewManager(eventBus, ctx) {
    const nodeMap = new Map();
    let unsubs = [];

    const render = () => {
        if (nodeMap.size === 0) return;
        const output = buildConsoleLine(nodeMap);
        if (typeof ctx?.ui?.notify === 'function') ctx.ui.notify(output, 'info');
    };

    const start = () => {
        unsubs = [
            eventBus.on('squad:init', (p) => {
                applyInit(nodeMap, p);
                render();
            }),
            eventBus.on('squad:node_state', (p) => {
                applyNodeState(nodeMap, p);
                render();
            }),
            eventBus.on('squad:complete', () => {
                for (const u of unsubs) u?.();
                unsubs = [];
            }),
            eventBus.on('squad:abort', () => {
                for (const u of unsubs) u?.();
                unsubs = [];
            }),
        ];
    };

    const cleanup = () => {
        for (const u of unsubs) u?.();
        unsubs = [];
    };

    return { start, cleanup };
}
