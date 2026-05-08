/**
 * Tests for block-head-tail — the oh-my-pi extension that strips
 * | head -nXXX and | tail -nXXX from bash tool commands.
 */

import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import blockHeadTailExtension from '../index.js';

// --------------------------------------------------------------------------
// Helpers: minimal pi stub matching oh-my-pi's ExtensionAPI
// --------------------------------------------------------------------------

function stubPi() {
    const events = {};
    const notifies = [];

    return {
        events,
        notifies,

        pi: {
            on(event, handler) {
                (events[event] ??= []).push(handler);
            },

            typebox: {},

            ui: {
                notify(msg, level) {
                    notifies.push({ msg, level });
                },
            },
        },
    };
}

// --------------------------------------------------------------------------
// Extension registration
// --------------------------------------------------------------------------

describe('extension registration', () => {
    it('hooks tool_call event', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        assert.ok(s.events['tool_call'], 'tool_call event not registered');
        assert.equal(s.events['tool_call'].length, 1, 'should have one handler');
    });

    it('is idempotent — calling extension twice does not re-register', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);
        const handlerCount = s.events['tool_call'].length;
        await blockHeadTailExtension(s.pi);
        assert.equal(s.events['tool_call'].length, handlerCount, 'handlers should not increase on second call');
    });
});

// --------------------------------------------------------------------------
// Bash command stripping behavior
// --------------------------------------------------------------------------

describe('bash command stripping', () => {
    it('strips | head -n from command', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'cat file | head -n 50' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(input.command, 'cat file');
    });

    it('strips | head -n without space between -n and number', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'ls -la | head -n10' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(input.command, 'ls -la');
    });

    it('strips | tail -n from command', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'dmesg | tail -n 20' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(input.command, 'dmesg');
    });

    it('strips | tail -n without space between -n and number', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'git log | tail -n5' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(input.command, 'git log');
    });

    it('does not modify command without head/tail pipe', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'ls -la' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(input.command, 'ls -la');
    });

    it('does not modify non-bash tool calls', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'cat file | head -n 50' };
        await s.events['tool_call'][0]({ toolName: 'read', input }, { ui: s.pi.ui });

        // read tool should not be modified
        assert.equal(input.command, 'cat file | head -n 50');
    });

    it('handles multiple head/tail pipes in one command', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'cat big.log | head -n 100 | tail -n 10' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(input.command, 'cat big.log');
    });

    it('handles leading/trailing whitespace gracefully', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: '  grep foo bar | tail -n  5' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(input.command, '  grep foo bar');
    });

    it('handles large numbers', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'find / -name "*.log" | head -n 99999' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(input.command, 'find / -name "*.log"');
    });

    it('does nothing when input.command is not a string', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const inputNull = { command: null };
        await s.events['tool_call'][0]({ toolName: 'bash', input: inputNull }, { ui: s.pi.ui });
        assert.equal(inputNull.command, null);

        const inputUndefined = {};
        await s.events['tool_call'][0]({ toolName: 'bash', input: inputUndefined }, { ui: s.pi.ui });
        assert.equal(inputUndefined.command, undefined);

        const inputNum = { command: 42 };
        await s.events['tool_call'][0]({ toolName: 'bash', input: inputNum }, { ui: s.pi.ui });
        assert.equal(inputNum.command, 42);
    });

    it('does not remove regular -n flags that are not head/tail', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'grep -n "pattern" file' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(input.command, 'grep -n "pattern" file');
    });

    it('does not remove head/tail when used without pipe', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'head -n 5 file.txt' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        // Without pipe, head/tail is a meaningful command, not a truncation pipe
        assert.equal(input.command, 'head -n 5 file.txt');
    });

    it('notifies user when modification occurs', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'cat file | head -n 50' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(s.notifies.length, 1);
        assert.ok(s.notifies[0].msg.includes('Stripped'), 'notification should mention stripping');
        assert.equal(s.notifies[0].level, 'warning');
    });

    it('does not notify when no modification occurs', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'ls -la' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(s.notifies.length, 0);
    });

    it('handles multiple spaces and tabs around pipe', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'ps aux  |    head -n 30' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(input.command, 'ps aux');
    });

    it('handles -n with extra spacing like head -n   50', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        const input = { command: 'journalctl -u nginx | tail -n   100' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        assert.equal(input.command, 'journalctl -u nginx');
    });

    it('matches head with capital letters', async () => {
        const s = stubPi();
        await blockHeadTailExtension(s.pi);

        // This is technically valid in bash since commands are usually lowercase,
        // but test the regex is case-sensitive as expected
        const input = { command: 'cat file | Head -n 50' };
        await s.events['tool_call'][0]({ toolName: 'bash', input }, { ui: s.pi.ui });

        // Should NOT match because regex is lowercase
        assert.equal(input.command, 'cat file | Head -n 50');
    });
});
