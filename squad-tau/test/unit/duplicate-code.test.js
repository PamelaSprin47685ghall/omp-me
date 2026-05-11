import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';

/**
 * run-worker.js duplicates session-events.js subscribeToSessionEvents.
 * Should use the shared function instead.
 */
describe('run-worker.js session subscribe', () => {
    it('must use subscribeToSessionEvents from session-events.js', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/run-worker.js', 'utf8');
        // Should import and use subscribeToSessionEvents
        assert.ok(
            src.includes('subscribeToSessionEvents'),
            'run-worker must import subscribeToSessionEvents from session-events.js',
        );
    });

    it('must not have inline session.subscribe handler', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/run-worker.js', 'utf8');
        // The inline subscribe handler duplicates session-events.js
        // Count occurrences of "session.subscribe" - should be 0 (uses the imported one)
        const inlineSubscribes = src.match(/session\.subscribe\(/g);
        assert.ok(
            !inlineSubscribes || inlineSubscribes.length === 0,
            'run-worker must NOT have inline session.subscribe (duplicates session-events.js)',
        );
    });
});
