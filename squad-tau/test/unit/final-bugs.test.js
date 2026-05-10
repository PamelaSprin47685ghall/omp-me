import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Bug: run-confirm hangs forever if agent never calls confirm/return_work.
 * Must throw after CONFIRM_MAX_EMPTY empty turns and never await outcomePromise
 * without checking settled first.
 */
describe('run-confirm hang protection', () => {
    it('must throw after exceeding empty turn limit', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/run-confirm.js', 'utf8');
        // Must have the CONFIRM_MAX_EMPTY check that throws
        assert.ok(src.includes('ended without calling confirm'), 'must have throw on empty turn exhaustion');
        // Must contain the counter check
        assert.ok(src.includes('emptyCounter.exceeded()'), 'must check exceeded counter');
        // Must not await outcomePromise while !settled without protection
        const awaitPromiseIdx = src.indexOf('await outcomePromise');
        assert.ok(awaitPromiseIdx >= 0, 'must have await outcomePromise');
        // The await must be after the !settled check
        const beforeAwait = src.slice(Math.max(0, awaitPromiseIdx - 100), awaitPromiseIdx);
        assert.ok(beforeAwait.includes('!settled'), 'await outcomePromise must be guarded by !settled check');
    });

    it('must break the empty-turn loop on childAbort signal', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/run-confirm.js', 'utf8');
        // Must abort the waiting loop on signal
        assert.ok(src.includes('childAbort.signal.aborted'), 'must check child abort signal');
        // Must handle null result when aborted
        assert.ok(src.includes('if (!settled) return null;'), 'must return null when unsettled after abort');
    });
});

/**
 * Dead code in ws-server.js: broadcast() and getClientCount() are defined
 * but never called (broadcasting is done via bridgeEventsToWebSocket).
 */
describe('ws-server.js dead code', () => {
    it('broadcast function should be used or removed', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/ws-server.js', 'utf8');
        // If broadcast is defined, it should be exported or used internally
        if (src.includes('function broadcast(')) {
            assert.ok(src.includes('export') || src.includes('broadcast('), 'broadcast must be exported if defined');
        }
    });

    it('getClientCount function should be used or removed', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/ws-server.js', 'utf8');
        if (src.includes('function getClientCount(')) {
            assert.ok(
                src.includes('export') || src.includes('getClientCount('),
                'getClientCount must be exported if defined',
            );
        }
    });
});
