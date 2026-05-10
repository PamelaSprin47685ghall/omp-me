/**
 * Squad flow integration tests.
 * @see PRD/08-testing.md §8.3
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createTestEnvironment } from './squad-flow-setup.js';

describe('Squad Flow - M mode', () => {
    let env;

    beforeAll(() => {
        env = createTestEnvironment();
    });

    test('environment creates successfully', () => {
        expect(env.pi).toBeDefined();
        expect(env.eventBus).toBeDefined();
        expect(env.modelPool).toBeDefined();
        expect(env.squadFsm).toBeDefined();
        expect(env.signal).toBeDefined();
    });

    test('squad FSM starts in idle state', () => {
        expect(env.squadFsm.state).toBe('idle');
    });
});

describe('Squad Flow - L mode', () => {
    let env;

    beforeAll(() => {
        env = createTestEnvironment();
    });

    test('model pool has worker and reviewer slots', () => {
        expect(env.modelPool.workerSlots.length).toBeGreaterThan(0);
        expect(env.modelPool.reviewerSlots.length).toBeGreaterThan(0);
    });
});
