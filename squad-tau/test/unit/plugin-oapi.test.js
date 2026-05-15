/**
 * Regression tests for OMP ExtensionAPI compliance.
 *
 * Verifies that:
 * 1. squad_delegate tool execute handler returns proper AgentToolResult
 *    { content: [...], isError?: boolean } on all paths (never throws)
 * 2. All OMP API calls match the real API signatures
 */
import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import squadPlugin from '../../server/plugin.js';
import { EventLog } from '../../server/event-log.js';
import { processDelegate } from '../../server/submit-plan.js';

function mockPi() {
    const tools = [];
    const events = [];
    return {
        tools,
        events,
        registerTool: (def) => tools.push(def),
        on: (event, handler) => events.push({ event, handler }),
        sendMessage: () => {},
        registerCommand: () => {},
    };
}

describe('squad_delegate tool AgentToolResult compliance', () => {
    test('execute returns structured error on missing plan_dir', async () => {
        const pi = mockPi();
        squadPlugin(pi);

        const tool = pi.tools.find((t) => t.name === 'squad_delegate');
        expect(tool).toBeDefined();
        expect(typeof tool.execute).toBe('function');

        const ctx = {
            sessionManager: {
                getSessionId: () => 'test-session',
                getSessionFile: () => '/tmp/fake.session',
            },
        };

        // Should NOT throw — must return structured error
        let result;
        try {
            result = await tool.execute('call-1', { plan_dir: '/nonexistent/dir' }, undefined, undefined, ctx);
        } catch (e) {
            expect.unreachable('execute must not throw: ' + e.message);
        }

        // AgentToolResult contract: { content: TextContent[], isError?: boolean }
        expect(result).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content[0]).toMatchObject({ type: 'text' });
        expect(typeof result.content[0].text).toBe('string');
        expect(result.isError).toBe(true);
    });

    test('execute returns structured error on invalid TOML', async () => {
        const pi = mockPi();
        squadPlugin(pi);
        const tool = pi.tools.find((t) => t.name === 'squad_delegate');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-oapi-'));
        try {
            // Create a file with invalid TOML
            fs.writeFileSync(
                path.join(tmpDir, 'n1.toml'),
                'task = "hello"\ndepends_on = [\n[[review_criteria]]\nname = "ok"\n',
            );

            const ctx = {
                sessionManager: {
                    getSessionId: () => 'test-session',
                },
            };

            let result;
            try {
                result = await tool.execute('call-2', { plan_dir: tmpDir }, undefined, undefined, ctx);
            } catch (e) {
                expect.unreachable('execute must not throw: ' + e.message);
            }

            expect(result).toBeDefined();
            expect(Array.isArray(result.content)).toBe(true);
            expect(result.content[0]).toMatchObject({ type: 'text' });
            expect(result.isError).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('execute returns AgentToolResult on empty directory', async () => {
        const pi = mockPi();
        squadPlugin(pi);
        const tool = pi.tools.find((t) => t.name === 'squad_delegate');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-oapi-empty-'));
        try {
            const ctx = {
                sessionManager: {
                    getSessionId: () => 'test-session',
                },
            };

            let result;
            try {
                result = await tool.execute('call-3', { plan_dir: tmpDir }, undefined, undefined, ctx);
            } catch (e) {
                expect.unreachable('execute must not throw: ' + e.message);
            }

            expect(result).toBeDefined();
            expect(Array.isArray(result.content)).toBe(true);
            expect(result.content[0]).toMatchObject({ type: 'text' });
            expect(result.isError).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('execute returns structured error on cycle validation', async () => {
        const pi = mockPi();
        squadPlugin(pi);
        const tool = pi.tools.find((t) => t.name === 'squad_delegate');

        // Create two nodes with a mutual dependency (cycle)
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-oapi-cycle-'));
        try {
            fs.writeFileSync(
                path.join(tmpDir, 'n1.toml'),
                'task = "write hello"\n' +
                    'depends_on = ["n2"]\n' +
                    '[[review_criteria]]\n' +
                    'name = "works"\n' +
                    'description = "it works"\n',
            );
            fs.writeFileSync(
                path.join(tmpDir, 'n2.toml'),
                'task = "write world"\n' +
                    'depends_on = ["n1"]\n' +
                    '[[review_criteria]]\n' +
                    'name = "works"\n' +
                    'description = "it works"\n',
            );

            const ctx = {
                sessionManager: {
                    getSessionId: () => 'test-session',
                },
            };

            let result;
            try {
                result = await tool.execute('call-5', { plan_dir: tmpDir }, undefined, undefined, ctx);
            } catch (e) {
                expect.unreachable('execute must not throw: ' + e.message);
            }

            expect(result).toBeDefined();
            expect(Array.isArray(result.content)).toBe(true);
            expect(result.content[0]).toMatchObject({ type: 'text' });
            expect(typeof result.content[0].text).toBe('string');
            expect(result.content[0].text).toMatch(/cyclic/);
            expect(result.isError).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('validatePlan unknown dependency check', () => {
    test('rejects plan with nonexistent dependency', async () => {
        const { validatePlan } = await import('../../server/validate-plan.js');
        const result = validatePlan({
            nodes: [
                { id: 'n1', depends_on: ['n2'], task: 'x', review_criteria: [] },
                { id: 'n2', depends_on: ['n3'], task: 'x', review_criteria: [] },
            ],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('n2') && e.includes('n3'))).toBe(true);
    });

    test('accepts plan with valid dependencies', async () => {
        const { validatePlan } = await import('../../server/validate-plan.js');
        const result = validatePlan({
            nodes: [
                { id: 'n1', depends_on: [], task: 'x', review_criteria: [] },
                { id: 'n2', depends_on: ['n1'], task: 'x', review_criteria: [] },
                { id: 'n3', depends_on: ['n1', 'n2'], task: 'x', review_criteria: [] },
            ],
        });
        expect(result.valid).toBe(true);
    });

    test('rejects self-reference as cycle', async () => {
        const { validatePlan } = await import('../../server/validate-plan.js');
        const result = validatePlan({
            nodes: [{ id: 'n1', depends_on: ['n1'], task: 'x', review_criteria: [] }],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('cyclic'))).toBe(true);
    });
});

describe('pi.on(input) handler compliance', () => {
    test('intercepts /squad command', async () => {
        const pi = mockPi();
        squadPlugin(pi);

        const inputHandler = pi.events.find((e) => e.event === 'input');
        expect(inputHandler).toBeDefined();

        const ctx = {
            ui: { notify: () => {} },
            sessionManager: { getSessionId: () => 'sid' },
        };

        const result = await inputHandler.handler(
            { text: '/squad write hello', images: [], source: 'interactive', type: 'input' },
            ctx,
        );
        // Must return handled:true to block further processing
        expect(result).toEqual({ handled: true });
    });

    test('non-/squad input returns void (not handled)', async () => {
        const pi = mockPi();
        squadPlugin(pi);

        const inputHandler = pi.events.find((e) => e.event === 'input');

        const result = await inputHandler.handler(
            { text: 'just a normal message', images: [], source: 'interactive', type: 'input' },
            { ui: { notify: () => {} } },
        );
        // void return → input flows through normally
        expect(result).toBeUndefined();
    });
});
