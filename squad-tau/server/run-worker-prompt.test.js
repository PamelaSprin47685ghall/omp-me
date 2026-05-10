import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkerPrompt } from './run-worker-prompt.js';

describe('buildWorkerPrompt', () => {
    it('basic: task only, no upstream, no feedback', () => {
        const node = { id: 'N001', task: 'Create server/constants.js' };
        const result = buildWorkerPrompt(node, null, null);

        assert.match(result, /## Task\nCreate server\/constants\.js/);
        assert.match(result, /You MUST call return_work\(\{summary, affected_files\}\) when done/);
        assert.doesNotMatch(result, /Context from Upstream/);
        assert.doesNotMatch(result, /REVIEWER FEEDBACK/);
    });

    it('with upstream: includes summary, files, and read instructions', () => {
        const node = { id: 'N002', task: 'Build worker prompt' };
        const upstreamResults = [
            { id: 'N001', summary: 'Created constants', affected_files: ['server/constants.js'] },
            { id: 'N003', summary: 'Added utils', affected_files: ['server/utils.js', 'server/helpers.js'] },
        ];
        const result = buildWorkerPrompt(node, upstreamResults, null);

        assert.match(result, /## Context from Upstream Tasks/);
        assert.match(result, /\*\*N001\*\*: Created constants/);
        assert.match(result, /Files: server\/constants\.js/);
        assert.match(result, /Use the `read` tool to inspect server\/constants\.js as needed/);
        assert.match(result, /\*\*N003\*\*: Added utils/);
        assert.match(result, /Files: server\/utils\.js, server\/helpers\.js/);
        assert.match(result, /Use the `read` tool to inspect server\/utils\.js, server\/helpers\.js as needed/);
    });

    it('with feedback: prepends REVIEWER FEEDBACK section', () => {
        const node = { id: 'N002', task: 'Build worker prompt' };
        const feedback = 'Missing return_work constraint footer.\nIncorrect upstream format.';
        const result = buildWorkerPrompt(node, null, feedback);

        assert.match(result, /=== REVIEWER FEEDBACK ===/);
        assert.match(result, /This is a retry\. Previous attempt was rejected by reviewer\./);
        assert.match(result, /Missing return_work constraint footer\./);
        assert.match(result, /Address every issue listed above before resubmitting\./);
    });

    it('full combo: task + upstream + feedback', () => {
        const node = { id: 'N002', task: 'Build worker prompt' };
        const upstreamResults = [{ id: 'N001', summary: 'Created constants', affected_files: ['server/constants.js'] }];
        const feedback = 'Footer format incorrect.';
        const result = buildWorkerPrompt(node, upstreamResults, feedback);

        assert.match(result, /## Task\nBuild worker prompt/);
        assert.match(result, /## Context from Upstream Tasks/);
        assert.match(result, /\*\*N001\*\*: Created constants/);
        assert.match(result, /=== REVIEWER FEEDBACK ===/);
        assert.match(result, /Footer format incorrect\./);
        assert.match(result, /You MUST call return_work\(\{summary, affected_files\}\) when done/);
    });
});
