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

export function createViewManager(eventBus, ctx) {
    const nodeMap = new Map();
    let unsubs = [];

    function handleInit(payload) {
        nodeMap.clear();
        for (const n of payload.nodes) {
            nodeMap.set(n.id, {
                id: n.id,
                status: n.depends_on?.length ? 'waiting_deps' : 'pending',
                retryCount: 0,
                deps: n.depends_on || [],
            });
        }
        render();
    }

    function handleNodeState(payload) {
        const n = nodeMap.get(payload.nodeId);
        if (!n) return;
        n.status = payload.status;
        if (payload.retryCount !== undefined) n.retryCount = payload.retryCount;
        render();
    }

    function cleanup() {
        for (const unsub of unsubs) unsub?.();
        unsubs = [];
        if (typeof ctx?.ui?.setWidget === 'function') {
            ctx.ui.setWidget('squad_status', undefined);
        }
    }

    function render() {
        if (typeof ctx?.ui?.setWidget !== 'function') return;
        if (nodeMap.size === 0) return;

        const parts = [];

        for (const n of nodeMap.values()) {
            const sym = SYM[n.status] || '?';
            let seg = `${n.id}${sym}`;

            if (
                n.retryCount > 0 &&
                (n.status === 'authoring' || n.status === 'confirming' || n.status === 'reviewing')
            ) {
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

            parts.push(seg);
        }

        const done = [...nodeMap.values()].filter((n) => n.status === 'approved').length;
        const total = nodeMap.size;
        const line = `squad: ${parts.join(', ')}`;

        // When everything is done, show a compact summary
        const output = done === total ? `squad: \u2713 ${done}/${total}` : line;

        ctx.ui.setWidget('squad_status', [output]);
    }

    function start() {
        unsubs = [
            eventBus.on('squad:init', handleInit),
            eventBus.on('squad:node_state', handleNodeState),
            eventBus.on('squad:complete', cleanup),
            eventBus.on('squad:abort', cleanup),
        ];
    }

    return { start, cleanup };
}
