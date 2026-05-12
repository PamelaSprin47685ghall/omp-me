import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { returnTool } from '../../server/lifecycle-tools.js';
import { register, setReturnResolver, unregister } from '../../server/session-registry.js';

describe('lifecycle-tools global return', () => {
    it('returnTool structure', () => {
        const tool = returnTool;
        assert.strictEqual(tool.name, 'return');
        assert.strictEqual(typeof tool.execute, 'function');
        assert.ok(tool.parameters.properties.status);
    });

    it('execute calls resolver and abort', async () => {
        const tool = returnTool;
        let resolvedValue = null;
        let aborted = false;

        const sessionFile = 'test-session.json';
        register(sessionFile, { status: 'active', sendUserMessage: () => {} });
        setReturnResolver(sessionFile, (val) => {
            resolvedValue = val;
        });

        const ctx = {
            sessionManager: {
                getSessionFile: () => sessionFile,
            },
            abort: () => {
                aborted = true;
            },
        };

        const result = await tool.execute('call-id', { status: 'ok', reason: 'done' }, 'sig', null, ctx);

        assert.deepEqual(resolvedValue, { status: 'ok', reason: 'done' });
        assert.strictEqual(aborted, true);
        assert.deepEqual(result, { content: [], display: false });

        unregister(sessionFile);
    });

    it('execute throws if sessionFile missing', async () => {
        const tool = returnTool;
        const ctx = { sessionManager: {} };
        await assert.rejects(() => tool.execute('id', {}, 'sig', null, ctx), /sessionFile is required/);
    });

    it('execute throws if resolver missing', async () => {
        const tool = returnTool;
        const sessionFile = 'no-resolver.json';
        register(sessionFile, { status: 'active', sendUserMessage: () => {} });
        const ctx = {
            sessionManager: { getSessionFile: () => sessionFile },
        };
        await assert.rejects(() => tool.execute('id', {}, 'sig', null, ctx), /No return resolver found/);
        unregister(sessionFile);
    });
});
