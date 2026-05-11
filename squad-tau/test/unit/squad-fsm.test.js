import { describe, test, expect } from 'bun:test';
import SquadFSM from '../../server/squad-fsm.js';

describe('SquadFSM', () => {
    test('starts in idle state', () => {
        const fsm = new SquadFSM();
        expect(fsm.isIdle()).toBe(true);
        expect(fsm.isActive()).toBe(false);
    });

    test('idle->active->idle cycle', () => {
        const fsm = new SquadFSM();

        fsm.activate();
        expect(fsm.isActive()).toBe(true);
        expect(fsm.isIdle()).toBe(false);

        fsm.deactivate();
        expect(fsm.isIdle()).toBe(true);
        expect(fsm.isActive()).toBe(false);
    });

    test('activate throws from active state', () => {
        const fsm = new SquadFSM();
        fsm.activate();
        expect(() => fsm.activate()).toThrow('Cannot activate from state: active');
    });

    test('deactivate works from any state', () => {
        const fsm1 = new SquadFSM();
        fsm1.deactivate();
        expect(fsm1.isIdle()).toBe(true);

        const fsm2 = new SquadFSM();
        fsm2.activate();
        fsm2.deactivate();
        expect(fsm2.isIdle()).toBe(true);
    });

    test('state queries are mutually exclusive', () => {
        const fsm = new SquadFSM();

        expect(fsm.isIdle()).toBe(true);
        expect(fsm.isActive()).toBe(false);

        fsm.activate();
        expect(fsm.isActive()).toBe(true);
        expect(fsm.isIdle()).toBe(false);
    });
});
