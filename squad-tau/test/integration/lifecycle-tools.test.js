/**
 * Small integration test: lifecycle tools + session-registry integration.
 * Tests the return tool's resolver mechanism directly.
 */
import { describe, test, expect } from 'bun:test';
import { buildGlobalReturnTool } from '../../server/lifecycle-tools.js';
import { register, unregister, setReturnResolver, clearReturnResolver } from '../../server/session-registry.js';

function makeCtx(sessionFile) {
    return {
        sessionManager: {
            getSessionFile: () => sessionFile,
        },
        abort: () => {},
    };
}

describe('return tool with session-registry resolver', () => {
    test('status ok resolves with reason and affected_files', async () => {
        const sessionId = 'rt-test-1';
        const tool = buildGlobalReturnTool();

        register(sessionId, { sendUserMessage: () => {}, session: null, status: 'authoring' });

        const resolvePromise = new Promise((resolve) => setReturnResolver(sessionId, resolve));

        await tool.execute(
            'call-1',
            { status: 'ok', reason: 'completed', affected_files: ['a.js'] },
            null,
            () => {},
            makeCtx(sessionId),
        );

        const result = await resolvePromise;
        expect(result.status).toBe('ok');
        expect(result.reason).toBe('completed');
        expect(result.affected_files).toEqual(['a.js']);

        clearReturnResolver(sessionId);
        unregister(sessionId);
    });

    test('status error passes through reason', async () => {
        const sessionId = 'rt-test-2';
        const tool = buildGlobalReturnTool();

        register(sessionId, { sendUserMessage: () => {}, session: null, status: 'authoring' });

        const resolvePromise = new Promise((resolve) => setReturnResolver(sessionId, resolve));

        await tool.execute('call-2', { status: 'error', reason: 'needs work' }, null, () => {}, makeCtx(sessionId));

        const result = await resolvePromise;
        expect(result.status).toBe('error');
        expect(result.reason).toBe('needs work');

        clearReturnResolver(sessionId);
        unregister(sessionId);
    });

    test('multiple sessions have independent resolvers', async () => {
        const tool = buildGlobalReturnTool();
        const results = [];

        register('s1', { sendUserMessage: () => {}, session: null, status: 'authoring' });
        register('s2', { sendUserMessage: () => {}, session: null, status: 'authoring' });
        setReturnResolver('s1', (r) => results.push({ session: 's1', ...r }));
        setReturnResolver('s2', (r) => results.push({ session: 's2', ...r }));

        await tool.execute('call-a', { status: 'ok', reason: 'first' }, null, () => {}, makeCtx('s1'));
        await tool.execute('call-b', { status: 'ok', reason: 'second' }, null, () => {}, makeCtx('s2'));

        expect(results.length).toBe(2);
        expect(results[0].status).toBe('ok');
        expect(results[0].reason).toBe('first');
        expect(results[1].status).toBe('ok');
        expect(results[1].reason).toBe('second');

        clearReturnResolver('s1');
        clearReturnResolver('s2');
        unregister('s1');
        unregister('s2');
    });
});
