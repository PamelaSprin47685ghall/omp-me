import { getCurrentRun } from './plugin-state.js';
import fs from 'fs';

export function createOnCompleteHandler({ pi, fsm, eventBus }) {
    return ({ results, mode, nodes, durationMs }) => {
        const nodeResults = results.map((r) => ({
            id: r.id || r.nodeId,
            status: r.status,
            summary: r.summary || '',
            affectedFiles: r.affectedFiles || [],
        }));

        const failed = nodeResults.filter((r) => r.status === 'failed' || r.status === 'blocked');
        const msg =
            failed.length > 0
                ? `Squad completed — ${failed.length} node(s) failed (${(durationMs / 1000).toFixed(1)}s)`
                : `Squad completed successfully (${(durationMs / 1000).toFixed(1)}s)`;

        if (eventBus) {
            eventBus.emit('squad', 'complete', { results: nodeResults, durationMs });
        }

        fsm.deactivate();
        pi.sendMessage(msg);

        const run = getCurrentRun();
        if (run?.ctx?.cwd) {
            try {
                const markerPath = `${run.ctx.cwd}/.squad-complete`;
                const marker = JSON.stringify(
                    { completedAt: Date.now(), durationMs, nodes: nodeResults.length },
                    null,
                    2,
                );
                fs.writeFileSync(markerPath, marker, 'utf8');
            } catch {}
        }
    };
}
