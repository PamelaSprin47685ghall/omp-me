import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import systemToUserExtension from '../index.js';

function stubPi() {
    const events = {};
    return {
        events,
        on(event, handler) {
            if (!events[event]) events[event] = [];
            events[event].push(handler);
        },
        async emit(event, payload) {
            const handlers = events[event] || [];
            let result = undefined;
            for (const handler of handlers) {
                const r = await handler(payload);
                if (r !== undefined) result = r;
            }
            return result;
        },
    };
}

describe('system-to-user extension', () => {
    it('registers before_provider_request handler', async () => {
        const pi = stubPi();
        await systemToUserExtension(pi);
        assert.ok(pi.events['before_provider_request']);
        assert.equal(pi.events['before_provider_request'].length, 1);
    });

    it('replaces role: system with role: user in messages', async () => {
        const pi = stubPi();
        await systemToUserExtension(pi);

        const payload = {
            messages: [
                { role: 'system', content: 'hello' },
                { role: 'user', content: 'q' },
                { role: 'assistant', content: 'a' },
            ],
        };
        const result = await pi.emit('before_provider_request', { payload });

        assert.ok(result);
        assert.equal(result.messages[0].role, 'user');
        assert.equal(result.messages[0].content, 'hello');
        assert.equal(result.messages[1].role, 'user');
        assert.equal(result.messages[2].role, 'assistant');
    });

    it('preserves other payload fields', async () => {
        const pi = stubPi();
        await systemToUserExtension(pi);

        const payload = {
            model: 'gpt-4',
            temperature: 0,
            messages: [{ role: 'system', content: 's' }],
        };
        const result = await pi.emit('before_provider_request', { payload });

        assert.equal(result.model, 'gpt-4');
        assert.equal(result.temperature, 0);
    });

    it('returns undefined when no system messages exist', async () => {
        const pi = stubPi();
        await systemToUserExtension(pi);

        const payload = {
            messages: [
                { role: 'user', content: 'q' },
                { role: 'assistant', content: 'a' },
            ],
        };
        const result = await pi.emit('before_provider_request', { payload });

        assert.equal(result, undefined);
    });

    it('returns undefined for payloads without messages array', async () => {
        const pi = stubPi();
        await systemToUserExtension(pi);

        const payload = { system: [{ text: 'hello' }] };
        const result = await pi.emit('before_provider_request', { payload });

        assert.equal(result, undefined);
    });

    it('handles mixed system and non-system messages', async () => {
        const pi = stubPi();
        await systemToUserExtension(pi);

        const payload = {
            messages: [
                { role: 'system', content: 's1' },
                { role: 'system', content: 's2' },
                { role: 'user', content: 'q' },
            ],
        };
        const result = await pi.emit('before_provider_request', { payload });

        assert.equal(result.messages[0].role, 'user');
        assert.equal(result.messages[1].role, 'user');
        assert.equal(result.messages[2].role, 'user');
    });
});
