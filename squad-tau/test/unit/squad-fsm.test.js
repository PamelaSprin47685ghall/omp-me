import { describe, test, expect } from 'bun:test';
import SquadFSM from '../../server/squad-fsm.js';

describe('SquadFSM', () => {
    test('starts in idle state', () => {
        const fsm = new SquadFSM();
        expect(fsm.isIdle()).toBe(true);
        expect(fsm.isActive()).toBe(false);
        expect(fsm.isRevising()).toBe(false);
    });

    test('idle->active->revising->active->idle cycle', () => {
        const fsm = new SquadFSM();

        fsm.activate();
        expect(fsm.isActive()).toBe(true);
        expect(fsm.isIdle()).toBe(false);

        fsm.revise();
        expect(fsm.isRevising()).toBe(true);
        expect(fsm.isActive()).toBe(false);

        fsm.reactivate();
        expect(fsm.isActive()).toBe(true);
        expect(fsm.isRevising()).toBe(false);

        fsm.deactivate();
        expect(fsm.isIdle()).toBe(true);
        expect(fsm.isActive()).toBe(false);
    });

    test('activate throws from active state', () => {
        const fsm = new SquadFSM();
        fsm.activate();
        expect(() => fsm.activate()).toThrow('Cannot activate from state: active');
    });

    test('activate throws from revising state', () => {
        const fsm = new SquadFSM();
        fsm.activate();
        fsm.revise();
        expect(() => fsm.activate()).toThrow('Cannot activate from state: revising');
    });

    test('revise throws from idle state', () => {
        const fsm = new SquadFSM();
        expect(() => fsm.revise()).toThrow('Cannot revise from state: idle');
    });

    test('revise throws from revising state', () => {
        const fsm = new SquadFSM();
        fsm.activate();
        fsm.revise();
        expect(() => fsm.revise()).toThrow('Cannot revise from state: revising');
    });

    test('reactivate throws from idle state', () => {
        const fsm = new SquadFSM();
        expect(() => fsm.reactivate()).toThrow('Cannot reactivate from state: idle');
    });

    test('reactivate throws from active state', () => {
        const fsm = new SquadFSM();
        fsm.activate();
        expect(() => fsm.reactivate()).toThrow('Cannot reactivate from state: active');
    });

    test('deactivate works from any state', () => {
        const fsm1 = new SquadFSM();
        fsm1.deactivate();
        expect(fsm1.isIdle()).toBe(true);

        const fsm2 = new SquadFSM();
        fsm2.activate();
        fsm2.deactivate();
        expect(fsm2.isIdle()).toBe(true);

        const fsm3 = new SquadFSM();
        fsm3.activate();
        fsm3.revise();
        fsm3.deactivate();
        expect(fsm3.isIdle()).toBe(true);
    });

    test('state queries are mutually exclusive', () => {
        const fsm = new SquadFSM();

        expect(fsm.isIdle()).toBe(true);
        expect(fsm.isActive() || fsm.isRevising()).toBe(false);

        fsm.activate();
        expect(fsm.isActive()).toBe(true);
        expect(fsm.isIdle() || fsm.isRevising()).toBe(false);

        fsm.revise();
        expect(fsm.isRevising()).toBe(true);
        expect(fsm.isIdle() || fsm.isActive()).toBe(false);
    });
});
