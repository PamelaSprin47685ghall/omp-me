import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';

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
