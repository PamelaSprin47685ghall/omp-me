import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { buildWorkerPrompt } from '../../server/run-worker-prompt.js';

describe('buildWorkerPrompt', () => {
    it('includes node task', () => {
        const node = { id: 'N001', task: 'Implement authentication module' };
        const result = buildWorkerPrompt(node, null, null);

        assert.match(result, /Implement authentication module/);
        assert.match(result, /你的任务/);
    });

    it('includes upstream results when provided', () => {
        const node = { id: 'N002', task: 'Build worker prompt' };
        const upstreamResults = [{ id: 'N001', summary: 'Created constants', affectedFiles: ['server/constants.js'] }];
        const result = buildWorkerPrompt(node, upstreamResults, null);

        assert.match(result, /上游任务结果/);
        assert.match(result, /N001: Created constants/);
        assert.match(result, /server\/constants\.js/);
    });

    it('includes reviewer feedback on retry via iteration history', () => {
        const node = { id: 'N002', task: 'Build worker prompt' };
        const history = [
            {
                workRecord: { reason: 'Initial attempt', affected_files: ['src/auth.js'] },
                feedback: 'Missing return_work constraint footer.',
            },
        ];
        const result = buildWorkerPrompt(node, null, history);

        assert.match(result, /审阅者反馈 \(1\)/);
        assert.match(result, /Missing return_work constraint footer\./);
        assert.match(result, /工作记录 \(1\)/);
    });

    it('omits feedback on first attempt', () => {
        const node = { id: 'N001', task: 'Write tests' };
        const result = buildWorkerPrompt(node, null, null);

        assert.doesNotMatch(result, /审阅者反馈/);
    });

    it('shows round number', () => {
        const node = { id: 'N001', task: 'Task' };
        let result = buildWorkerPrompt(node, null, null);
        assert.match(result, /现在是第 1 轮/);

        const history = [{ workRecord: { reason: 'first' }, feedback: 'revise' }];
        result = buildWorkerPrompt(node, null, history);
        assert.match(result, /现在是第 2 轮/);
    });
});
