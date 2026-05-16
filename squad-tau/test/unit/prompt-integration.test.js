/**
 * Prompt-builder — regression + contract tests.
 *
 * This file tests:
 * 1. Pure function contract: buildPrompt produces correct output per phase
 * 2. foldNodeHistory correctly folds EventLog into iteration rounds
 * 3. Integration: session:pending_creation handler should emit
 *    session:start + session:message with the generated prompt
 */
import { describe, it, beforeAll } from 'bun:test';
import assert from 'node:assert/strict';

// ── Pure function tests ──

describe('buildPrompt — pure function contract', () => {
    let buildPrompt, project, EventLog;

    beforeAll(async () => {
        const mod = await import('../../server/prompt-builder.js');
        buildPrompt = mod.buildPrompt;
        const p = await import('../../shared/projections.js');
        project = p.project;
        const el = await import('../../server/event-log.js');
        EventLog = el.EventLog;
    });

    it('produces worker prompt with task and return constraint (no undefined leaks)', () => {
        const eventLog = new EventLog();
        eventLog.append('squad:init', {
            mode: 'M',
            nodes: [{ id: 'n1', depends_on: [] }],
            originalTask: 'Build login',
        });
        const state = project(eventLog.getLog());
        state.squad.planConfig = {
            n1: {
                task: 'Implement login form with validation',
                review_criteria: [
                    { name: 'UX', description: 'Must be intuitive' },
                    { name: 'Security', description: 'No SQL injection' },
                ],
            },
        };
        const node = state.nodes.n1;
        const prompt = buildPrompt('authoring', state, node, eventLog);

        assert.ok(prompt.includes('Implement login form'), 'prompt must contain task');
        assert.ok(prompt.includes('Must be intuitive'), 'prompt must contain review criteria');
        assert.ok(prompt.includes('No SQL injection'), 'prompt must contain all criteria');
        assert.ok(prompt.includes('return 工具'), 'prompt must mention return tool');
        assert.ok(!prompt.includes('undefined'), 'prompt must not contain undefined');
        assert.ok(prompt.includes('第 1 轮'), 'first round label present');
    });

    it('confirming prompt includes original task and review dimensions', () => {
        const eventLog = new EventLog();
        eventLog.append('squad:init', {
            mode: 'M',
            nodes: [{ id: 'n1', depends_on: [] }],
            originalTask: 'Build login',
        });
        const state = project(eventLog.getLog());
        state.squad.planConfig = {
            n1: { task: 'Implement login form', review_criteria: [{ name: 'UX', description: 'Must be intuitive' }] },
        };
        const node = state.nodes.n1;
        const prompt = buildPrompt('confirming', state, node, eventLog);

        assert.ok(prompt.includes('Implement login form'), 'confirm prompt includes original task');
        assert.ok(!prompt.includes('undefined'), 'no undefined');
    });

    it('reviewer prompt includes work record from EventLog', () => {
        const eventLog = new EventLog();
        eventLog.append('squad:init', {
            mode: 'M',
            nodes: [{ id: 'n1', depends_on: [] }],
            originalTask: 'Build login',
        });
        eventLog.append('session:creating', {
            sessionId: 'urn:squad:session:n1:v0:p0',
            nodeId: 'n1',
            phase: 'authoring',
            epoch: 0,
        });
        eventLog.append('session:start', {
            sessionId: 'urn:squad:session:n1:v0:p0',
            nodeId: 'n1',
            epoch: 0,
            phase: 'authoring',
        });
        eventLog.append('tool_call:started', {
            toolId: 't1',
            toolName: 'return',
            sessionId: 'urn:squad:session:n1:v0:p0',
            params: { reason: 'Implemented login form', affected_files: ['login.js'] },
        });

        const state = project(eventLog.getLog());
        state.squad.planConfig = {
            n1: { task: 'Implement login form', review_criteria: [] },
        };
        const node = state.nodes.n1;
        const prompt = buildPrompt('reviewing', state, node, eventLog);

        assert.ok(prompt.includes('Implemented login form'), 'reviewer sees work record');
        assert.ok(prompt.includes('login.js'), 'reviewer sees affected files');
        assert.ok(!prompt.includes('undefined'), 'no undefined');
    });

    it('outer_review prompt lists all node results', () => {
        const eventLog = new EventLog();
        eventLog.append('squad:init', {
            mode: 'L',
            nodes: [
                { id: 'n1', depends_on: [] },
                { id: 'n2', depends_on: [] },
            ],
            originalTask: 'Build feature A and B',
        });
        eventLog.append('squad:node_state', { nodeId: 'n1', status: 'approved' });
        eventLog.append('squad:node_state', { nodeId: 'n2', status: 'failed' });

        const state = project(eventLog.getLog());
        state.squad.planConfig = {
            n1: { task: 'Build A' },
            n2: { task: 'Build B' },
        };

        const prompt = buildPrompt('outer_review', state, state.nodes.n1, eventLog);

        assert.ok(prompt.includes('Build feature A and B'), 'outer_review includes original task');
        assert.ok(prompt.includes('n1'), 'lists n1');
        assert.ok(prompt.includes('approved'), 'lists approved status');
        assert.ok(prompt.includes('n2'), 'lists n2');
        assert.ok(prompt.includes('failed'), 'lists failed status');
        assert.ok(!prompt.includes('undefined'), 'no undefined');
    });

    it('M mode warning says 唯一执行者', () => {
        const eventLog = new EventLog();
        eventLog.append('squad:init', { mode: 'M', nodes: [{ id: 'n1', depends_on: [] }], originalTask: 'test' });
        const state = project(eventLog.getLog());
        state.squad.planConfig = { n1: { task: 'test' } };
        const prompt = buildPrompt('authoring', state, state.nodes.n1, eventLog);
        assert.ok(prompt.includes('唯一执行者'), 'M mode: 唯一执行者');
    });

    it('L mode warning says 只负责一部分', () => {
        const eventLog = new EventLog();
        eventLog.append('squad:init', {
            mode: 'L',
            nodes: [
                { id: 'n1', depends_on: [] },
                { id: 'n2', depends_on: [] },
            ],
            originalTask: 'test',
        });
        const state = project(eventLog.getLog());
        state.squad.planConfig = { n1: { task: 'test' } };
        const prompt = buildPrompt('authoring', state, state.nodes.n1, eventLog);
        assert.ok(prompt.includes('你只负责整个系统的一部分'), 'L mode warning should mention 只负责一部分');
    });
});

// ── foldNodeHistory unit tests ──

describe('foldNodeHistory — EventLog scanning for iteration rounds', () => {
    let foldNodeHistory, EventLog;

    beforeAll(async () => {
        const mod = await import('../../server/prompt-builder.js');
        foldNodeHistory = mod.foldNodeHistory;
        const el = await import('../../server/event-log.js');
        EventLog = el.EventLog;
    });

    it('empty eventLog returns empty rounds', () => {
        const eventLog = new EventLog();
        const rounds = foldNodeHistory(eventLog, 'n1');
        assert.equal(rounds.length, 0);
    });

    it('single return adds one round with work record', () => {
        const eventLog = new EventLog();
        eventLog.append('session:creating', { sessionId: 's1', nodeId: 'n1', phase: 'authoring', epoch: 0 });
        eventLog.append('session:start', { sessionId: 's1', nodeId: 'n1', epoch: 0 });
        eventLog.append('tool_call:started', {
            toolId: 't1',
            toolName: 'return',
            sessionId: 's1',
            params: { reason: 'done', affected_files: ['f1'] },
        });

        const rounds = foldNodeHistory(eventLog, 'n1');
        assert.equal(rounds.length, 1);
        assert.equal(rounds[0].workRecord.reason, 'done');
        assert.deepEqual(rounds[0].workRecord.affected_files, ['f1']);
    });

    it('ignores other nodes sessions', () => {
        const eventLog = new EventLog();
        eventLog.append('session:creating', { sessionId: 's1', nodeId: 'n1', phase: 'authoring', epoch: 0 });
        eventLog.append('session:start', { sessionId: 's1', nodeId: 'n1', epoch: 0 });
        eventLog.append('tool_call:started', {
            toolId: 't1',
            toolName: 'return',
            sessionId: 's1',
            params: { reason: 'n1 work' },
        });
        eventLog.append('session:creating', { sessionId: 's2', nodeId: 'n2', phase: 'authoring', epoch: 0 });
        eventLog.append('session:start', { sessionId: 's2', nodeId: 'n2', epoch: 0 });
        eventLog.append('tool_call:started', {
            toolId: 't2',
            toolName: 'return',
            sessionId: 's2',
            params: { reason: 'n2 work' },
        });

        const rounds = foldNodeHistory(eventLog, 'n1');
        assert.equal(rounds.length, 1);
        assert.equal(rounds[0].workRecord.reason, 'n1 work');
    });

    it('associates feedback with correct round via epoch', () => {
        const eventLog = new EventLog();
        eventLog.append('session:creating', { sessionId: 's1', nodeId: 'n1', phase: 'authoring', epoch: 0 });
        eventLog.append('session:start', { sessionId: 's1', nodeId: 'n1', epoch: 0 });
        eventLog.append('tool_call:started', {
            toolId: 't1',
            toolName: 'return',
            sessionId: 's1',
            params: { reason: 'attempt 1', epoch: 0 },
        });
        eventLog.append('squad:node_state', { nodeId: 'n1', feedback: 'needs work', epoch: 0 });

        const rounds = foldNodeHistory(eventLog, 'n1');
        assert.equal(rounds.length, 1);
        assert.equal(rounds[0].feedback, 'needs work');
    });
});

// ── Side-effect handler pattern (integration contract test) ──

describe('Session prompt integration — side-effect handler contract', () => {
    let converge;

    beforeAll(async () => {
        const c = await import('../helpers/converge.js');
        converge = c.converge;
    });

    it('session:pending_creation → session:start + session:message with prompt', () => {
        const prompts = [];

        const { log, state } = converge(
            [
                {
                    event: 'squad:init',
                    payload: {
                        mode: 'M',
                        nodes: [{ id: 'n1', depends_on: [] }],
                        originalTask: 'Test regression',
                    },
                },
            ],
            {
                'session:pending_creation': (payload, emit) => {
                    emit('session:start', {
                        sessionId: payload.sessionId,
                        nodeId: payload.nodeId,
                        epoch: payload.epoch,
                        phase: payload.phase,
                        model: 'test',
                    });
                    emit('session:message', {
                        sessionId: payload.sessionId,
                        role: 'user',
                        content: [{ type: 'text', text: 'Worker: implement feature' }],
                    });
                },
                'session:pending_prompt': (payload) => {
                    prompts.push(payload.text);
                },
            },
        );

        assert.ok(prompts.length >= 1, 'at least one prompt must be delivered');
        assert.ok(prompts[0].includes('implement feature'), 'prompt text should match');

        const sessMsgs = log.filter((e) => e.event === 'session:message');
        assert.ok(sessMsgs.length >= 1, 'session:message events must exist in log');
        assert.equal(sessMsgs[0].payload.role, 'user', 'prompt role is user');
    });

    it('handler without prompt emission produces ZERO session:message events (current broken state)', () => {
        const { log } = converge(
            [
                {
                    event: 'squad:init',
                    payload: {
                        mode: 'M',
                        nodes: [{ id: 'n1', depends_on: [] }],
                        originalTask: 'Test',
                    },
                },
            ],
            {
                'session:pending_creation': (payload, emit) => {
                    emit('session:start', {
                        sessionId: payload.sessionId,
                        nodeId: payload.nodeId,
                        epoch: payload.epoch,
                        phase: payload.phase,
                        model: 'test',
                    });
                    emit('session:end', { sessionId: payload.sessionId, reason: 'completed' });
                },
            },
        );

        const sessMsgs = log.filter((e) => e.event === 'session:message');
        assert.equal(sessMsgs.length, 0, 'current broken state: no prompt emitted');
    });
});
