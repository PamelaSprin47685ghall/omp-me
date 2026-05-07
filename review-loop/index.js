/**
 * review-loop — oh-my-pi extension for automated iterative review cycles.
 *
 * Port of pi-captain (omp-auto-loop).
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import LoopFSM from './loop-fsm.js';
import { getLoopControlToolDefinition, createRenderCall, createRenderResult } from './tool.js';

const OMP_BASE = join(homedir(), '.bun/install/global/node_modules/@oh-my-pi');

let _agentMod = null;
async function getAgentMod() {
    if (!_agentMod) {
        _agentMod = await import('file://' + join(OMP_BASE, 'pi-coding-agent/src/index.ts'));
    }
    return _agentMod;
}

const registered = new WeakSet();

export default async function reviewLoopExtension(pi) {
    if (registered.has(pi)) return;

    try {
        const { StringEnum, Text } = await getAgentMod();
        const fsm = new LoopFSM(pi);

        pi.on('session_start', async (_e, ctx) => fsm.reconstruct(ctx));
        pi.on('session_switch', async (_e, ctx) => fsm.reconstruct(ctx));
        pi.on('session_fork', async (_e, ctx) => fsm.reconstruct(ctx));
        pi.on('session_tree', async (_e, ctx) => fsm.reconstruct(ctx));
        pi.on('agent_start', async (_e, ctx) => fsm.onAgentStart(ctx));
        pi.on('tool_call', async (event, ctx) => fsm.onToolCall(event, ctx));
        pi.on('input', async (event, ctx) => fsm.onInput(event, ctx));
        pi.on('before_agent_start', async (event, ctx) => fsm.onBeforeAgentStart(event, ctx));
        pi.on('agent_end', async (e, ctx) => fsm.onAgentEnd(e, ctx));

        pi.registerTool({
            ...getLoopControlToolDefinition(pi.typebox, StringEnum),
            async execute(_id, params, _signal, _onUpdate, ctx) {
                return fsm.executeTool(_id, params, _signal, _onUpdate, ctx);
            },
            renderCall: createRenderCall(Text),
            renderResult: createRenderResult(Text),
        });

        pi.registerCommand('loop-stop', {
            description: 'Stop the active loop',
            handler: async (_args, ctx) => fsm.stop(ctx, 'Stopped by user'),
        });

        pi.registerCommand('once', {
            description: 'Send a single, non-looping turn',
            handler: async (args, ctx) => fsm.executeOnceCommand(args, ctx),
        });

        pi.registerShortcut('ctrl+shift+s', {
            description: 'Stop the active loop, let current turn finish',
            handler: async (ctx) => {
                fsm.stop(ctx, 'Stopped by shortcut');
            },
        });

        registered.add(pi);
    } catch (error) {
        registered.delete(pi);
        throw error;
    }
}
