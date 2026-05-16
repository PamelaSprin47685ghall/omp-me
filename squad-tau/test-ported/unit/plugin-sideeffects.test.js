import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import { returnTool, acceptTool, rejectTool } from '../../server/lifecycle-tools.js';
import { assertAgentToolResult, assertToolDefinition, assertNeverThrows } from '../helpers/contract-validator.js';

/**
 * OMP Tool Contract Tests (physical-barrier assertions).
 *
 * Every tool.execute() MUST:
 * 1. Return { content: Array<{ type: 'text', text: string }>, isError?: boolean }
 * 2. NEVER throw — all error paths return structured isError=true responses
 * 3. Have correct name, execute function, and parameters schema
 *
 * These tests run WITHOUT squadPlugin(pi) because squadPlugin fires
 * startServer() which starts a real HTTP+Vite server. We test tool
 * contract in isolation — the geometric truth of the interface.
 *
 * Phase-specific tool injection is tested in converge.js integration tests.
 * OMP event binding (commands, input handlers) is verified by plugin.js
 * unit tests that mock the pi object without calling startServer.
 */

describe('Tool definitions — shape contract', () => {
    it('returnTool has correct name, execute, parameters', () => {
        assertToolDefinition(returnTool, 'return');
        assert.ok(returnTool.parameters.required.includes('status'), 'return requires status');
        assert.ok(returnTool.parameters.required.includes('reason'), 'return requires reason');
    });

    it('acceptTool has correct name, execute, parameters', () => {
        assertToolDefinition(acceptTool, 'accept');
        assert.ok(acceptTool.parameters.required.includes('reason'), 'accept requires reason');
    });

    it('rejectTool has correct name, execute, parameters', () => {
        assertToolDefinition(rejectTool, 'reject');
        assert.ok(rejectTool.parameters.required.includes('reason'), 'reject requires reason');
    });

    it('all tools have display:false on their return value (no OMP UI popup)', async () => {
        const results = await Promise.all([
            returnTool.execute('id', { status: 'ok', reason: 'd' }, 'sig', null, null),
            acceptTool.execute('id', { reason: 'ok' }, 'sig', null, null),
            rejectTool.execute('id', { reason: 'bad' }, 'sig', null, null),
        ]);
        for (const r of results) {
            assertAgentToolResult(r);
            assert.equal(r.display, false, 'tool must return display:false to prevent OMP from showing popup');
        }
    });
});

describe('Tool execute — AgentToolResult contract', () => {
    it('returnTool returns correct shape on success path', async () => {
        let aborted = false;
        const result = await returnTool.execute(
            'call-1',
            { status: 'ok', reason: 'implemented feature X', affected_files: ['a.js', 'b.js'] },
            'sig',
            null,
            {
                abort: () => {
                    aborted = true;
                },
            },
        );
        assertAgentToolResult(result);
        assert.equal(aborted, true, 'execute must call ctx.abort');
    });

    it('returnTool never throws with null/missing ctx', async () => {
        const result = await assertNeverThrows(() =>
            returnTool.execute('call-2', { status: 'ok', reason: 'done' }, 'sig', null, null),
        );
        assertAgentToolResult(result);
    });

    it('returnTool never throws with empty params', async () => {
        const result = await assertNeverThrows(() => returnTool.execute('call-3', {}, 'sig', null, null));
        assertAgentToolResult(result);
    });

    it('acceptTool returns correct shape on success path', async () => {
        let aborted = false;
        const result = await acceptTool.execute(
            'call-4',
            { reason: 'all criteria met', affected_files: ['a.js'] },
            'sig',
            null,
            {
                abort: () => {
                    aborted = true;
                },
            },
        );
        assertAgentToolResult(result);
        assert.equal(aborted, true);
    });

    it('acceptTool never throws with null ctx', async () => {
        const result = await assertNeverThrows(() =>
            acceptTool.execute('call-5', { reason: 'good' }, 'sig', null, null),
        );
        assertAgentToolResult(result);
    });

    it('rejectTool returns correct shape on success path', async () => {
        let aborted = false;
        const result = await rejectTool.execute(
            'call-6',
            { reason: 'missing test coverage', affected_files: [] },
            'sig',
            null,
            {
                abort: () => {
                    aborted = true;
                },
            },
        );
        assertAgentToolResult(result);
        assert.equal(aborted, true);
    });

    it('rejectTool never throws with null ctx', async () => {
        const result = await assertNeverThrows(() =>
            rejectTool.execute('call-7', { reason: 'bad' }, 'sig', null, null),
        );
        assertAgentToolResult(result);
    });
});

describe('Tool execute — edge case resilience', () => {
    it('returnTool handles missing affected_files', async () => {
        const result = await returnTool.execute('id', { status: 'ok', reason: 'done' }, 'sig', null, {
            abort: () => {},
        });
        assertAgentToolResult(result);
    });

    it('acceptTool handles missing affected_files', async () => {
        const result = await acceptTool.execute('id', { reason: 'ok' }, 'sig', null, { abort: () => {} });
        assertAgentToolResult(result);
    });

    it('rejectTool handles missing affected_files', async () => {
        const result = await rejectTool.execute('id', { reason: 'bad' }, 'sig', null, { abort: () => {} });
        assertAgentToolResult(result);
    });

    it('all tools handle undefined as ctx', async () => {
        const results = await Promise.all([
            assertNeverThrows(() => returnTool.execute('id', { status: 'ok', reason: 'd' }, 'sig', null, undefined)),
            assertNeverThrows(() => acceptTool.execute('id', { reason: 'ok' }, 'sig', null, undefined)),
            assertNeverThrows(() => rejectTool.execute('id', { reason: 'bad' }, 'sig', null, undefined)),
        ]);
        for (const r of results) assertAgentToolResult(r);
    });
});
