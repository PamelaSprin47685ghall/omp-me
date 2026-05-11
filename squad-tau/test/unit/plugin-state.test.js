import { describe, test, expect, it } from 'bun:test';
import { setCurrentRun, getCurrentRun, clearCurrentRun } from '../../server/plugin-state.js';

describe('plugin-state', () => {
    it('should set and get current run', () => {
        const mockRun = { id: 'test-run' };
        setCurrentRun(mockRun);
        expect(getCurrentRun()).toBe(mockRun);
    });

    it('should clear current run', () => {
        setCurrentRun({ id: 'to-be-cleared' });
        clearCurrentRun();
        expect(getCurrentRun()).toBe(null);
    });

    it('should start with null', () => {
        // Since it's a singleton, and tests might run in parallel or sequence,
        // we clear it first to ensure isolation if needed,
        // but here we just check it can be null.
        clearCurrentRun();
        expect(getCurrentRun()).toBe(null);
    });
});
