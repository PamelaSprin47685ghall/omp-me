import { describe, test, expect } from 'bun:test';
import { createOnCompleteHandler } from '../../server/squad-complete.js';
import { EventBus } from '../../server/event-bus.js';
import SquadFSM from '../../server/squad-fsm.js';

describe('createOnCompleteHandler', () => {
    const baseDeps = {
        task: 'Build feature X',
        ctx: {},
        pi: { sendMessage: () => {} },
        signal: new AbortController().signal,
        eventBus: new EventBus(),
        modelPool: {
            acquire: async () => null,
            release: () => {},
        },
        fsm: new SquadFSM(),
        startTime: Date.now(),
    };

    test('builds nodeResults from results not from nodes', async () => {
        const results = [
            { nodeId: 'n1', status: 'approved', summary: 'Done N1', affectedFiles: ['a.js'] },
            { nodeId: 'n2', status: 'approved', summary: 'Done N2', affectedFiles: ['b.js'] },
        ];

        let emittedResult = null;
        baseDeps.eventBus.on('squad:complete', (payload) => {
            emittedResult = payload;
        });

        baseDeps.fsm.activate();
        const handler = createOnCompleteHandler(baseDeps);
        await handler({ results, mode: 'M', nodes: [] });

        expect(emittedResult).not.toBeNull();
        expect(emittedResult.results.length).toBe(2);
        expect(emittedResult.results[0].id).toBe('n1');
        expect(emittedResult.results[0].status).toBe('approved');
        expect(emittedResult.results[0].summary).toBe('Done N1');
        expect(emittedResult.results[0].affectedFiles).toEqual(['a.js']);
    });

    test('deactivates FSM for M mode', async () => {
        const fsm = new SquadFSM();
        fsm.activate();
        expect(fsm.isActive()).toBe(true);

        const handler = createOnCompleteHandler({ ...baseDeps, fsm });
        await handler({
            results: [{ nodeId: 'n1', status: 'approved', summary: 'Done', affectedFiles: [] }],
            mode: 'M',
            nodes: [],
        });

        expect(fsm.isIdle()).toBe(true);
    });

    test('emits squad:complete event for M mode', async () => {
        const events = [];
        const eb = new EventBus();
        eb.on('*', (payload, type) => {
            if (type === 'squad:complete') events.push(payload);
        });

        const fsm = new SquadFSM();
        fsm.activate();

        const handlerStartTime = Date.now() - 100; // 100ms ago
        const handler = createOnCompleteHandler({
            ...baseDeps,
            eventBus: eb,
            fsm,
            startTime: handlerStartTime,
        });
        await handler({
            results: [{ nodeId: 'n1', status: 'approved', summary: 'Ok', affectedFiles: [] }],
            mode: 'M',
            nodes: [],
            durationMs: Date.now() - handlerStartTime,
        });

        expect(events.length).toBe(1);
        expect(events[0].durationMs).toBeGreaterThanOrEqual(100);
    });

    test('returns empty summary and affectedFiles when results lack them', async () => {
        const results = [{ nodeId: 'n1', status: 'approved' }];

        let emittedResult = null;
        const eb = new EventBus();
        eb.on('squad:complete', (payload) => {
            emittedResult = payload;
        });

        const fsm = new SquadFSM();
        fsm.activate();

        const handler = createOnCompleteHandler({ ...baseDeps, eventBus: eb, fsm });
        await handler({ results, mode: 'M', nodes: [] });

        expect(emittedResult.results[0].summary).toBe('');
        expect(emittedResult.results[0].affectedFiles).toEqual([]);
    });
});
