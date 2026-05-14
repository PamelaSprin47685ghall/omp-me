import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { returnTool } from '../../server/lifecycle-tools.js';

describe('lifecycle-tools', () => {
    it('returnTool structure', () => {
        assert.strictEqual(returnTool.name, 'return');
        assert.strictEqual(typeof returnTool.execute, 'function');
        assert.ok(returnTool.parameters.properties.status);
        assert.ok(returnTool.parameters.properties.reason);
    });

    it('execute calls ctx.abort and returns result', async () => {
        let aborted = false;
        const result = await returnTool.execute('call-id', { status: 'ok', reason: 'done' }, 'sig', null, {
            abort: () => {
                aborted = true;
            },
        });
        assert.strictEqual(aborted, true);
        assert.deepEqual(result, { content: [], display: false });
    });

    it('execute handles missing ctx gracefully', async () => {
        const result = await returnTool.execute('id', { status: 'ok', reason: 'done' }, 'sig', null, null);
        assert.deepEqual(result, { content: [], display: false });
    });
});
