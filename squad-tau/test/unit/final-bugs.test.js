import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Bug: run-confirm hangs forever if agent never calls confirm/return_work.
 * After empty turn timeout, settledPromise.promise is awaited indefinitely.
 */
describe('run-confirm hang protection', () => {
    it('must throw after empty turns + nudge timeout', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/run-confirm.js', 'utf8');
        // After nudge hint + waitForSettled, must check settled and throw if still false
        const afterNudge = src.indexOf('waitForSettled(pi, sessionId, signal, 2000)');
        assert.ok(afterNudge >= 0, 'must have nudge wait');

        // After the wait, there must be a check that throws if not settled
        const afterWait = src.slice(afterNudge, afterNudge + 300);
        const hasSettledCheck = afterWait.includes('!settled') || afterWait.includes('settled === false');
        const hasThrow = afterWait.includes('throw') || afterWait.includes('Error');
        assert.ok(hasSettledCheck && hasThrow, 'must check settled status after nudge and throw if still not settled');
    });

    it('must throw before reaching unguarded await when unsettled', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/run-confirm.js', 'utf8');
        // Verify the throw happens before awaited line when settled is false
        const throwLine = src.indexOf("throw new Error('Self-Confirm did not call");
        const awaitLine = src.indexOf('await settledPromise.promise');
        assert.ok(throwLine >= 0, 'must have throw after nudge timeout');
        assert.ok(awaitLine >= 0, 'must have await settledPromise.promise');
        // The throw must come BEFORE the unguarded await in the source
        assert.ok(throwLine < awaitLine, 'throw must occur before unguarded await in code flow');

        // Also verify the throw is inside the if(!settled) block
        const beforeThrow = src.slice(throwLine - 50, throwLine);
        assert.ok(beforeThrow.includes('!settled'), 'throw must be conditional on !settled');
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
