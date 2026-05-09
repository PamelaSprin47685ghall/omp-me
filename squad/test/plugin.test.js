import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';

function stubPi() {
    const events = {};
    return {
        events,
        on(event, handler) {
            (events[event] ??= []).push(handler);
        },
        registerCommand(name, opts) {
            this.commands ??= {};
            this.commands[name] = opts;
        },
        registerTool(tool) {
            this.tools ??= {};
            this.tools[tool.name] = tool;
        },
        getActiveTools() {
            return [];
        },
        setActiveTools(t) {
            this.activeTools = t;
        },
        sendMessage() {},
    };
}

let _uid = 0;
function freshPlugin() {
    return import(`../index.js?uid=${++_uid}`).then((m) => m.default);
}

describe('squad plugin', () => {
    it('registers commands, tool, and hooks events', async () => {
        const squadPlugin = await freshPlugin();
        const pi = stubPi();
        await squadPlugin(pi);

        assert.ok(pi.commands.squad);
        assert.ok(pi.commands['squad-models']);
        assert.ok(pi.tools.submit_plan);
        assert.equal(typeof pi.tools.submit_plan.execute, 'function');
        assert.ok(pi.events.input);
        assert.ok(pi.events.agent_end);
        assert.ok(pi.events.session_shutdown);
    });

    it('is idempotent after first registration', async () => {
        const squadPlugin = await freshPlugin();
        const pi = stubPi();
        await squadPlugin(pi);

        const pi2 = stubPi();
        await squadPlugin(pi2);
        assert.equal(Object.keys(pi2.tools ?? {}).length, 0);
        assert.equal(Object.keys(pi2.commands ?? {}).length, 0);
    });
});
