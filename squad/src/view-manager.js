const STATUS_GLYPHS = {
    pending: '\u25CB',
    waiting_deps: '\u23F3',
    authoring: '\u27F3',
    confirming: '\u27F3',
    reviewing: '\u27F3',
    approved: '\u2713',
    failed: '\u2716',
    blocked: '\u26A0',
};

const STATUS_LABELS = {
    pending: 'Pending',
    waiting_deps: 'Waiting',
    authoring: 'Authoring',
    confirming: 'Self-Review',
    reviewing: 'Reviewing',
    approved: 'Approved',
    failed: 'Failed',
    blocked: 'Blocked',
};

export function createViewManager(ctx) {
    const nodeStates = new Map();
    const sessionRecords = new Map();

    function registerNode(nodeId, label, dependsOn) {
        nodeStates.set(nodeId, {
            id: nodeId,
            label: label || nodeId,
            status: 'pending',
            retryCount: 0,
            startedAt: null,
            dependsOn: dependsOn || [],
        });
    }

    function registerSession(nodeId, role, sessionFile, session) {
        sessionRecords.set(`${nodeId}#${role}`, {
            nodeId,
            role,
            sessionFile,
            session,
            status: 'running',
        });
    }

    function updateNodeState(nodeId, status, extra) {
        const node = nodeStates.get(nodeId);
        if (!node) return;
        node.status = status;

        if (extra != null && extra.retryCount !== undefined) node.retryCount = extra.retryCount;

        if (status === 'authoring' || status === 'confirming' || status === 'reviewing') {
            if (!node.startedAt) node.startedAt = Date.now();
        }

        renderWidget();
    }

    function renderWidget() {
        if (typeof ctx?.ui?.setWidget !== 'function') return;

        const lines = ['[ Squad Progress ]'];

        for (const node of nodeStates.values()) {
            const glyph = STATUS_GLYPHS[node.status] || '?';
            let suffix = '';

            if (node.status === 'reviewing' && node.retryCount > 0) {
                suffix = ` - R${node.retryCount + 1}`;
            } else if (node.status === 'confirming' && node.retryCount > 0) {
                suffix = ` - R${node.retryCount + 1}`;
            } else if (node.status === 'waiting_deps') {
                const pendingDeps = node.dependsOn.filter((depId) => {
                    const dep = nodeStates.get(depId);
                    return dep && dep.status !== 'approved';
                });
                suffix = pendingDeps.length > 0 ? ` (Waiting: ${pendingDeps.join(', ')})` : ' (Waiting)';
            } else {
                const label = STATUS_LABELS[node.status] || node.status;
                suffix = ` (${label})`;
            }

            lines.push(`${glyph} ${node.label}${suffix}`);
        }

        if (lines.length === 1) {
            lines.push('(idle)');
        }

        ctx.ui.setWidget('squad_status', lines);
    }

    function clearWidget() {
        if (typeof ctx?.ui?.setWidget === 'function') {
            ctx.ui.setWidget('squad_status', undefined);
        }
    }

    function getSessionRecords() {
        return [...sessionRecords.values()];
    }

    return {
        registerNode,
        registerSession,
        updateNodeState,
        renderWidget,
        clearWidget,
        getSessionRecords,
    };
}
