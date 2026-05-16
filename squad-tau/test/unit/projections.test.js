import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { getInitialState, applyEvent, project } from '../../shared/projections.js';

describe('Projections — O(1) Incremental Folder', () => {
    // ── Counter Integrity ──

    it('empty state has activeCount 0', () => {
        const s = getInitialState();
        assert.equal(s.stats.activeCount, 0);
    });

    it('session:start increments activeCount to 1', () => {
        const s = applyEvent(getInitialState(), 'session:start', {
            sessionId: 'urn:squad:node:n1:v0',
            nodeId: 'n1',
            epoch: 0,
        });
        assert.equal(s.stats.activeCount, 1);
    });

    it('two session:start increments activeCount to 2', () => {
        let s = getInitialState();
        s = applyEvent(s, 'session:start', { sessionId: 'urn:squad:node:n1:v0', nodeId: 'n1', epoch: 0 });
        s = applyEvent(s, 'session:start', { sessionId: 'urn:squad:node:n2:v0', nodeId: 'n2', epoch: 0 });
        assert.equal(s.stats.activeCount, 2);
    });

    it('session:end decrements activeCount', () => {
        let s = getInitialState();
        s = applyEvent(s, 'session:start', { sessionId: 'urn:squad:node:n1:v0', nodeId: 'n1', epoch: 0 });
        s = applyEvent(s, 'session:start', { sessionId: 'urn:squad:node:n2:v0', nodeId: 'n2', epoch: 0 });
        s = applyEvent(s, 'session:end', { sessionId: 'urn:squad:node:n1:v0' });
        assert.equal(s.stats.activeCount, 1);
    });

    // ── Hash Map O(1) Lookup ──

    it('state.nodes is a plain hash, not an array — O(1) access', () => {
        let s = applyEvent(getInitialState(), 'squad:init', {
            nodes: [
                { id: 'n1', depends_on: [] },
                { id: 'n2', depends_on: ['n1'] },
            ],
        });
        // Direct property access — O(1)
        const n1 = s.nodes.n1;
        assert.equal(n1.id, 'n1');
        // No .find() would be needed
        assert.equal(Object.keys(s.nodes).length, 2);
    });

    it('state.runtime.sessions[urn] is direct O(1) access', () => {
        let s = getInitialState();
        s = applyEvent(s, 'session:start', {
            sessionId: 'urn:squad:node:n1:v0',
            nodeId: 'n1',
            epoch: 0,
        });
        const sess = s.runtime.sessions['urn:squad:node:n1:v0'];
        assert.equal(sess.nodeId, 'n1');
        assert.equal(sess.status, 'active');
    });

    // ── Immutability & Structural Sharing ──

    it('applyEvent returns new root object', () => {
        const s = getInitialState();
        const s2 = applyEvent(s, 'session:start', {
            sessionId: 'urn:squad:node:n1:v0',
            nodeId: 'n1',
            epoch: 0,
        });
        assert.notStrictEqual(s2, s);
    });

    it('unchanged branches retain reference identity', () => {
        const s = getInitialState();
        // Pre-populate nodes
        let s2 = applyEvent(s, 'squad:init', {
            nodes: [{ id: 'n1', depends_on: [] }],
        });
        const prevNodes = s2.nodes;
        const prevRuntime = s2.runtime;

        // session:start only touches runtime.sessions and stats
        s2 = applyEvent(s2, 'session:start', {
            sessionId: 'urn:squad:node:n1:v0',
            nodeId: 'n1',
            epoch: 0,
        });

        assert.notStrictEqual(s2, s); // root changed
        assert.notStrictEqual(s2.runtime, prevRuntime); // runtime changed (new session)
        assert.notStrictEqual(s2.stats, s.stats); // stats changed (activeCount++)
        assert.strictEqual(s2.nodes, prevNodes); // nodes untouched — same ref
    });

    // ── project() full fold ──

    it('project folds an array of entries into final state', () => {
        const facts = [
            { event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }] } },
            { event: 'session:start', payload: { sessionId: 'urn:squad:node:n1:v0', nodeId: 'n1', epoch: 0 } },
            { event: 'session:end', payload: { sessionId: 'urn:squad:node:n1:v0' } },
        ];
        const s = project(facts);
        assert.equal(s.stats.activeCount, 0);
        assert.equal(s.runtime.sessions['urn:squad:node:n1:v0'].status, 'ended');
        assert.equal(s.nodes.n1.id, 'n1');
    });

    // ── Ghost Recovery: serialisation round-trip ──

    it('JSON round-trip produces identical state', () => {
        const facts = [
            { event: 'session:start', payload: { sessionId: 'urn:squad:node:n1:v0', nodeId: 'n1', epoch: 0 } },
            { event: 'session:start', payload: { sessionId: 'urn:squad:node:n2:v0', nodeId: 'n2', epoch: 0 } },
            { event: 'session:end', payload: { sessionId: 'urn:squad:node:n1:v0' } },
        ];

        const hot = project(facts);
        const serialised = JSON.parse(JSON.stringify(facts));
        const cold = project(serialised);

        assert.deepEqual(cold, hot);
    });

    // ── Error on missing required fields ──

    it('session:start without sessionId throws', () => {
        assert.throws(() => {
            applyEvent(getInitialState(), 'session:start', { nodeId: 'n1', epoch: 0 });
        }, /sessionId/);
    });

    it('session:end for unknown session throws', () => {
        const s = getInitialState();
        assert.throws(() => {
            applyEvent(s, 'session:end', { sessionId: 'nonexistent' });
        }, /unknown session/);
    });

    it('squad:init without nodes throws', () => {
        assert.throws(() => {
            applyEvent(getInitialState(), 'squad:init', {});
        }, /nodes/);
    });

    // ── Ported: node lifecycle ──

    it('squad:init creates nodes with correct initial status', () => {
        const s = applyEvent(getInitialState(), 'squad:init', {
            nodes: [
                { id: 'n1', depends_on: [] },
                { id: 'n2', depends_on: ['n1'] },
            ],
            mode: 'M',
        });
        assert.equal(s.nodes.n1.status, 'authoring', 'no-dep node starts authoring');
        assert.equal(s.nodes.n2.status, undefined, 'dep node starts undefined');
        assert.equal(s.squad.status, 'active');
        assert.equal(s.squad.mode, 'M');
    });

    it('node:phase_advanced advances node through phases', () => {
        let s = applyEvent(getInitialState(), 'squad:init', {
            nodes: [{ id: 'n1', depends_on: [] }],
            mode: 'M',
        });
        // authoring → confirming
        s = applyEvent(s, 'node:phase_advanced', { nodeId: 'n1', status: 'confirming' });
        assert.equal(s.nodes.n1.status, 'confirming');
        // confirming → reviewing
        s = applyEvent(s, 'node:phase_advanced', { nodeId: 'n1', status: 'reviewing' });
        assert.equal(s.nodes.n1.status, 'reviewing');
        // reviewing → approved
        s = applyEvent(s, 'node:phase_advanced', { nodeId: 'n1', status: 'approved' });
        assert.equal(s.nodes.n1.status, 'approved');
    });

    it('node:rejected sets node to rejected with feedback', () => {
        let s = applyEvent(getInitialState(), 'squad:init', {
            nodes: [{ id: 'n1', depends_on: [] }],
            mode: 'M',
        });
        s = applyEvent(s, 'squad:node_state', { nodeId: 'n1', status: 'reviewing' });
        s = applyEvent(s, 'node:rejected', { nodeId: 'n1', sessionId: 's1', feedback: 'needs work' });
        assert.equal(s.nodes.n1.status, 'rejected');
        assert.equal(s.nodes.n1.feedback, 'needs work');
    });

    it('node:failed sets node to failed', () => {
        let s = applyEvent(getInitialState(), 'squad:init', {
            nodes: [{ id: 'n1', depends_on: [] }],
            mode: 'M',
        });
        s = applyEvent(s, 'node:failed', { nodeId: 'n1' });
        assert.equal(s.nodes.n1.status, 'failed');
    });

    it('node:rejected for unknown node throws', () => {
        assert.throws(() => {
            applyEvent(getInitialState(), 'node:rejected', { nodeId: 'nonexistent', sessionId: 's1' });
        }, /unknown node/);
    });

    it('node:failed for unknown node throws', () => {
        assert.throws(() => {
            applyEvent(getInitialState(), 'node:failed', { nodeId: 'nonexistent' });
        }, /unknown node/);
    });

    it('node:phase_advanced for unknown node throws', () => {
        assert.throws(() => {
            applyEvent(getInitialState(), 'node:phase_advanced', { nodeId: 'nonexistent', status: 'approved' });
        }, /unknown node/);
    });

    // ── Ported: squad lifecycle ──

    it('squad:abort sets squad status to aborted', () => {
        let s = applyEvent(getInitialState(), 'squad:init', {
            nodes: [{ id: 'n1', depends_on: [] }],
            mode: 'M',
        });
        s = applyEvent(s, 'squad:abort', {});
        assert.equal(s.squad.status, 'aborted');
    });

    it('config:capacity_changed updates maxWorkers', () => {
        const s = applyEvent(getInitialState(), 'config:capacity_changed', { maxWorkers: 10 });
        assert.equal(s.config.maxWorkers, 10);
    });

    // ── Ported: messages ──

    it('message:start creates skeleton entry', () => {
        let s = getInitialState();
        s = applyEvent(s, 'message:start', { messageId: 'msg_1', sessionId: 's1' });
        assert.ok(s.messages.msg_1, 'message entry created');
        assert.equal(s.messages.msg_1.status, 'streaming');
        assert.equal(s.messages.msg_1.sessionId, 's1');
        assert.equal(s.messages.msg_1.role, 'assistant');
        assert.equal(s.messages.msg_1.blocks.length, 1);
        assert.equal(s.messages.msg_1.blocks[0].type, 'text');
    });

    it('message:finalized marks skeleton as finalized', () => {
        let s = getInitialState();
        s = applyEvent(s, 'message:start', { messageId: 'msg_1', sessionId: 's1' });
        s = applyEvent(s, 'message:finalized', { messageId: 'msg_1', staticContent: 'Hello World' });
        assert.equal(s.messages.msg_1.status, 'finalized');
        assert.equal(s.messages.msg_1.staticContent, 'Hello World');
    });

    it('message:start without messageId throws', () => {
        assert.throws(() => {
            applyEvent(getInitialState(), 'message:start', { sessionId: 's1' });
        }, /messageId/);
    });

    it('message:finalized for unknown message throws', () => {
        assert.throws(() => {
            applyEvent(getInitialState(), 'message:finalized', { messageId: 'nonexistent' });
        }, /unknown message/);
    });

    it('message:start with parentId preserves it on skeleton', () => {
        const s = applyEvent(getInitialState(), 'message:start', {
            messageId: 'msg_2',
            sessionId: 's1',
            parentId: 'msg_1',
        });
        assert.equal(s.messages.msg_2.parentId, 'msg_1');
    });

    it('message:start without parentId omits parentId field', () => {
        const s = applyEvent(getInitialState(), 'message:start', { messageId: 'msg_3', sessionId: 's1' });
        assert.equal(s.messages.msg_3.parentId, undefined);
    });

    it('message:start twice same ID overwrites not duplicates', () => {
        let s = getInitialState();
        s = applyEvent(s, 'message:start', { messageId: 'dup', sessionId: 's1' });
        s = applyEvent(s, 'message:start', { messageId: 'dup', sessionId: 's2', parentId: 'other' });
        assert.equal(s.messages.dup.sessionId, 's2');
    });

    // ── Round 2: mainSessionId ──

    it('squad:register_main_session stores sessionId', () => {
        const s = applyEvent(getInitialState(), 'squad:register_main_session', { sessionId: 'main-1' });
        assert.equal(s.squad.mainSessionId, 'main-1');
    });

    it('squad:init preserves existing mainSessionId', () => {
        let s = applyEvent(getInitialState(), 'squad:register_main_session', { sessionId: 'pre-init' });
        s = applyEvent(s, 'squad:init', { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' });
        assert.equal(s.squad.mainSessionId, 'pre-init');
    });

    it('squad:init with mainSessionId payload stores it', () => {
        const s = applyEvent(getInitialState(), 'squad:init', {
            nodes: [{ id: 'n1', depends_on: [] }],
            mode: 'M',
            mainSessionId: 'inline-main',
        });
        assert.equal(s.squad.mainSessionId, 'inline-main');
    });

    it('squad:replan preserves mainSessionId', () => {
        let s = applyEvent(getInitialState(), 'squad:init', {
            nodes: [{ id: 'n1', depends_on: [] }],
            mode: 'M',
            mainSessionId: 'original',
        });
        s = applyEvent(s, 'squad:replan', {
            nodes: [{ id: 'a1', depends_on: [] }],
            mode: 'L',
            mainSessionId: 'original',
        });
        assert.equal(s.squad.mainSessionId, 'original');
    });

    // ── Round 2: tool_call:started/finished ──

    it('tool_call:started creates toolCall entity (O(1) hash)', () => {
        const s = applyEvent(getInitialState(), 'tool_call:started', {
            toolId: 't1',
            toolName: 'read',
            params: { path: 'x.js' },
            sessionId: 's1',
        });
        assert.ok(s.toolCalls.t1);
        assert.equal(s.toolCalls.t1.toolName, 'read');
        assert.equal(s.toolCalls.t1.status, 'running');
    });

    it('tool_call:finished updates toolCall result with isError', () => {
        let s = getInitialState();
        s = applyEvent(s, 'tool_call:started', { toolId: 't1', toolName: 'bash', sessionId: 's1' });
        s = applyEvent(s, 'tool_call:finished', { toolId: 't1', result: 'error output', isError: true });
        assert.equal(s.toolCalls.t1.status, 'done');
        assert.equal(s.toolCalls.t1.isError, true);
        assert.equal(s.toolCalls.t1.result, 'error output');
    });

    it('tool_call:finished for unknown toolId throws', () => {
        assert.throws(() => {
            applyEvent(getInitialState(), 'tool_call:finished', { toolId: 'nonexistent' });
        }, /unknown toolId/);
    });

    // ── Round 2: session:creating alias (old protocol compat) ──

    it('session:creating aliases to session:pending_creation', () => {
        const s = applyEvent(getInitialState(), 'session:creating', {
            sessionId: 'urn:session:test',
            nodeId: 'n1',
            phase: 'authoring',
            epoch: 0,
        });
        assert.ok(s.runtime.sessions['urn:session:test']);
        assert.equal(s.runtime.sessions['urn:session:test'].status, 'pending');
    });

    // ── Ported: useSessionState — lifecycle semantics ──

    it('session lifecycle pending_creation→start→end: activeCount 0→1→0', () => {
        let s = getInitialState();
        assert.equal(s.stats.activeCount, 0);
        s = applyEvent(s, 'session:pending_creation', {
            sessionId: 'urn:s:s1:v0',
            nodeId: 'n1',
            phase: 'authoring',
            epoch: 0,
        });
        assert.equal(s.stats.activeCount, 0, 'pending does not change count');
        s = applyEvent(s, 'session:start', { sessionId: 'urn:s:s1:v0', nodeId: 'n1', epoch: 0 });
        assert.equal(s.stats.activeCount, 1, 'start increments');
        s = applyEvent(s, 'session:end', { sessionId: 'urn:s:s1:v0', reason: 'completed' });
        assert.equal(s.stats.activeCount, 0, 'end decrements');
    });

    it('session:end with errorMessage preserves error detail on runtime entry', () => {
        let s = getInitialState();
        s = applyEvent(s, 'session:start', { sessionId: 'urn:s:s2:v0', nodeId: 'n1', epoch: 0 });
        s = applyEvent(s, 'session:end', { sessionId: 'urn:s:s2:v0', reason: 'error', errorMessage: 'LLM timeout' });
        assert.equal(s.runtime.sessions['urn:s:s2:v0'].status, 'ended');
        assert.equal(s.runtime.sessions['urn:s:s2:v0'].reason, 'error');
        assert.equal(s.runtime.sessions['urn:s:s2:v0'].errorMessage, 'LLM timeout');
    });

    it('activeCount monotonic: 2 starts → 1 end → 0 end = 0', () => {
        let s = getInitialState();
        s = applyEvent(s, 'session:start', { sessionId: 'urn:s:a:v0', nodeId: 'n1', epoch: 0 });
        s = applyEvent(s, 'session:start', { sessionId: 'urn:s:b:v0', nodeId: 'n2', epoch: 0 });
        assert.equal(s.stats.activeCount, 2);
        s = applyEvent(s, 'session:end', { sessionId: 'urn:s:a:v0' });
        assert.equal(s.stats.activeCount, 1);
        s = applyEvent(s, 'session:end', { sessionId: 'urn:s:b:v0' });
        assert.equal(s.stats.activeCount, 0);
    });

    // ── Ported: unknown event type returns state unchanged ──

    it('unknown event type returns state unchanged', () => {
        const s = getInitialState();
        const s2 = applyEvent(s, 'UNKNOWN_EVENT_TYPE', { someKey: 'value' });
        assert.deepEqual(s2, s, 'state unchanged for unknown event');
    });
});
