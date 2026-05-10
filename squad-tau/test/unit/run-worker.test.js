import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { buildWorkerPrompt } from '../../server/run-worker-prompt.js';

describe('buildWorkerPrompt', () => {
    it('includes node task', () => {
        const node = { id: 'N001', task: 'Implement authentication module' };
        const result = buildWorkerPrompt(node, null, null);

        assert.match(result, /## Task/);
        assert.match(result, /Implement authentication module/);
    });

    it('includes upstream results when provided', () => {
        const node = { id: 'N002', task: 'Build worker prompt' };
        const upstreamResults = [{ id: 'N001', summary: 'Created constants', affected_files: ['server/constants.js'] }];
        const result = buildWorkerPrompt(node, upstreamResults, null);

        assert.match(result, /## Context from Upstream Tasks/);
        assert.match(result, /\*\*N001\*\*: Created constants/);
        assert.match(result, /Files: server\/constants\.js/);
    });

    it('includes reviewer feedback on retry', () => {
        const node = { id: 'N002', task: 'Build worker prompt' };
        const feedback = 'Missing return_work constraint footer.';
        const result = buildWorkerPrompt(node, null, feedback);

        assert.match(result, /Reviewer Feedback from Previous Attempt/);
        assert.match(result, /Missing return_work constraint footer\./);
        assert.match(result, /Address every issue listed above before resubmitting\./);
    });

    it('omits feedback on first attempt', () => {
        const node = { id: 'N001', task: 'Write tests' };
        const result = buildWorkerPrompt(node, null, null);

        assert.doesNotMatch(result, /Reviewer Feedback/);
    });
});
