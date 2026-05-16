import assert from 'node:assert/strict';
import { describe, it, beforeAll } from 'bun:test';

/**
 * Prompt is the IDL between Squad-Tau and the LLM.
 * If the prompt says JSON but submit-plan.js reads .toml,
 * the system silently explodes. This test locks the contract.
 */
describe('prompt contract — .toml self-consistency', () => {
    let prompt;

    beforeAll(async () => {
        const mod = await import('../../server/plugin.js');
        prompt = mod._CLASSIFICATION_PROMPT;
    });

    it('prompt instructs LLM to write .toml files', () => {
        assert.ok(prompt.includes('.toml'), 'prompt must mention .toml');
    });

    it('prompt does NOT tell LLM to write JSON in plan instructions', () => {
        const instructStart = prompt.indexOf('You MUST write');
        if (instructStart > -1) {
            const instruct = prompt.slice(instructStart, instructStart + 300);
            assert.ok(!instruct.includes('JSON'), 'plan instructions must not mention JSON');
        }
    });

    it('prompt is non-empty and contains squad_delegate reference', () => {
        assert.ok(prompt.length > 100);
        assert.ok(prompt.includes('squad_delegate'));
    });
});
