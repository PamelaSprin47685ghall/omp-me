import { describe, it, expect, beforeEach } from 'vitest';
import { createRetryState } from '../../server/retry-logic.js';

describe('createRetryState', () => {
    let retryState;

    beforeEach(() => {
        retryState = createRetryState();
    });

    it('increment bumps count', () => {
        retryState.increment('feedback');
        expect(retryState.retryCount).toBe(1);
        retryState.increment('more');
        expect(retryState.retryCount).toBe(2);
    });

    it('increment stores feedback', () => {
        retryState.increment('test feedback');
        expect(retryState.lastFeedback).toBe('test feedback');
        retryState.increment('new feedback');
        expect(retryState.lastFeedback).toBe('new feedback');
    });

    it('reset clears state', () => {
        retryState.increment('test');
        retryState.increment('test');
        retryState.reset();
        expect(retryState.retryCount).toBe(0);
        expect(retryState.lastFeedback).toBe(null);
    });

    it('getState returns correct shape', () => {
        expect(retryState.getState()).toEqual({ retryCount: 0, lastFeedback: null });
        retryState.increment('feedback');
        expect(retryState.getState()).toEqual({ retryCount: 1, lastFeedback: 'feedback' });
    });
});
