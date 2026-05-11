import { describe, test, expect, it } from 'bun:test';
import { buildBaseSessionOptions, buildWorkerSessionOptions } from '../../server/session-options.js';

describe('session-options', () => {
    const mockCtx = {
        cwd: '/test/cwd',
        model: { provider: 'p1', id: 'm1' },
        workspaceTree: 'tree',
        agentsMdSearch: 'search',
        modelRegistry: {
            getAvailable: () => [
                { provider: 'p1', id: 'm1' },
                { provider: 'p2', id: 'm2' },
            ],
        },
        getThinkingLevel: () => 'high',
        getSystemPrompt: () => 'system',
        session: {
            getActiveToolNames: () => ['read', 'write', 'delegate'],
        },
    };

    it('builds base options correctly', () => {
        const opts = buildBaseSessionOptions(mockCtx, null, null);
        expect(opts.cwd).toBe('/test/cwd');
        expect(opts.model).toEqual({ provider: 'p1', id: 'm1' });
        expect(opts.workspaceTree).toBe('tree');
        expect(opts.thinkingLevel).toBe('high');
        expect(opts.systemPrompt).toBe('system');
    });

    it('uses modelSlot to override model', () => {
        const slot = { provider: 'p2', modelId: 'm2', thinkingLevel: 'medium' };
        const opts = buildBaseSessionOptions(mockCtx, null, slot);
        expect(opts.model).toEqual({ provider: 'p2', id: 'm2' });
        expect(opts.thinkingLevel).toBe('medium');
    });

    it('builds worker options and filters delegate tool', () => {
        const opts = buildWorkerSessionOptions(mockCtx, null, null);
        expect(opts.toolNames).toEqual(['read', 'write']);
        expect(opts.toolNames).not.toContain('delegate');
    });

    it('fallbacks to process.cwd()', () => {
        const opts = buildBaseSessionOptions({}, null, null);
        expect(opts.cwd).toBe(process.cwd());
    });
});
