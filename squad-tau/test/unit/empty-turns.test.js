import { describe, it, expect } from 'bun:test';
import { createCounter, MAX_EMPTY_TURNS } from '../../server/empty-turns.js';

describe('createCounter', () => {
    it('increments and reports exceeded after maxTurns', () => {
        const c = createCounter(3);
        c.increment();
        expect(c.exceeded()).toBe(false);
        c.increment();
        c.increment();
        expect(c.exceeded()).toBe(true);
    });

    it('uses MAX_EMPTY_TURNS constant', () => {
        expect(MAX_EMPTY_TURNS).toBe(20);
    });

    it('reset clears the counter', () => {
        const c = createCounter(2);
        c.increment();
        c.increment();
        expect(c.exceeded()).toBe(true);
        c.reset();
        expect(c.exceeded()).toBe(false);
    });
});
