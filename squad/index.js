import { executeDAG } from './src/dag-engine.js';
import { createViewManager } from './src/view-manager.js';
import { loadModelsConfig, saveModelsConfig, getConfigPath } from './src/model-pool.js';
import SquadFSM from './src/squad-fsm.js';
import { runOuterReview } from './src/outer-review.js';

const registered = new WeakSet();
const activeRunsBySessionId = new Map();
let nextRunId = 0;

const CLASSIFICATION_PROMPT = [
    '## Squad Task',
    '',
    'Classify this task:',
    '- **M** — multi-file but cohesive, needs review: call `submit_plan` with mode "M" and exactly 1 node `{id, task, review_criteria}`.',
    '- **L** — multi-module, strong dependencies, parallel work: call `submit_plan` with mode "L" and nodes `[{id, task, review_criteria, depends_on}]`.',
    '',
    'You MUST call `submit_plan` before ending your turn.',
].join('\n');

export default async function squadPlugin(pi) {
    if (registered.has(pi)) return;

    const fsm = new SquadFSM();

    // -- /squad command (one-shot) --
    pi.registerCommand('squad', {
        description: 'Execute a task via squad. No args opens session switcher.',
        handler: async (args, ctx) => {
            const task = (args ?? '').trim();

            if (!task) {
                await showSessionSwitcher(ctx);
                return;
            }

            if (fsm.isActive()) {
                ctx.ui.notify('Squad is already running. Wait for it to finish.', 'warn');
                return;
            }

            fsm.originalTask = task;
            fsm.toActive();
            const currentTools = pi.getActiveTools();
            await pi.setActiveTools([...currentTools, 'submit_plan']);

            pi.sendMessage(
                { customType: 'squad-activate', content: `${CLASSIFICATION_PROMPT}\n\n${task}`, display: false },
                { triggerTurn: true },
            );
        },
    });

    // -- squad-once: one-shot instruction to a worker session --
    pi.registerCommand('squad-once', {
        description: 'Send a one-shot instruction to a squad worker session',
        handler: async (args, ctx) => {
            await sendOnceInstruction(args, ctx);
        },
    });

    // -- squad-models: generate model pool config --
    pi.registerCommand('squad-models', {
        description: 'Generate initial squad model pool config',
        handler: async (_args, ctx) => {
            const result = generateModelsConfig(ctx);
            ctx.ui.notify(result, 'info');
        },
    });

    // -- input interception: prevent /squad* commands from reaching LLM --
    pi.on('input', async (event) => {
        const text = event.text.trim();
        if (!text.startsWith('/squad')) return;
        return { handled: true };
    });

    // -- agent_end: revision forcing --
    pi.on('agent_end', async () => {
        if (!fsm.isRevising()) return;
        pi.sendMessage(
            {
                customType: 'squad-revision-force',
                content: 'You MUST call `submit_plan` with a revised plan before ending your turn.',
                display: false,
            },
            { triggerTurn: true },
        );
    });

    // -- session cleanup --
    pi.on('session_shutdown', async (_event, ctx) => {
        const sessionId = ctx?.sessionManager?.getSessionId?.();
        if (typeof ctx?.ui?.setWidget === 'function') {
            ctx.ui.setWidget('squad_status', undefined);
        }
        if (sessionId) {
            const prefix = sessionId + ':';
            for (const [key, run] of activeRunsBySessionId) {
                if (key.startsWith(prefix)) {
                    activeRunsBySessionId.delete(key);
                    for (const rec of run.viewManager.getSessionRecords()) {
                        rec.session?.abort?.();
                    }
                    run.viewManager.clearWidget();
                }
            }
        }
        fsm.toIdle();
    });

    // -- submit_plan tool --
    pi.registerTool({
        name: 'submit_plan',
        label: 'Submit Plan',
        description:
            'Submit execution plan for squad. Mode M for single reviewable task, mode L for multi-module parallel work.',
        parameters: {
            type: 'object',
            properties: {
                mode: {
                    type: 'string',
                    enum: ['M', 'L'],
                    description: 'Execution mode: M for single node, L for multi-node DAG',
                },
                reasoning: {
                    type: 'string',
                    description: 'Why this classification',
                },
                nodes: {
                    type: 'array',
                    description: 'Task nodes to execute',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'Unique node ID' },
                            task: { type: 'string', description: 'Detailed task description' },
                            review_criteria: { type: 'string', description: 'Criteria for reviewer approval' },
                            depends_on: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'IDs of prerequisite nodes',
                            },
                        },
                        required: ['id', 'task', 'review_criteria'],
                    },
                },
            },
            required: ['mode', 'reasoning', 'nodes'],
        },
        defaultInactive: true,

        async execute(_id, params, signal, _onUpdate, ctx) {
            if (!fsm.isActive()) {
                return {
                    content: [{ type: 'text', text: 'Squad is not active. Use /squad to start.' }],
                    isError: true,
                };
            }

            const plan = validatePlan(params);
            const start = Date.now();
            const sessionId = ctx?.sessionManager?.getSessionId?.();
            const masterSessionFile = ctx?.sessionManager?.getSessionFile?.() ?? null;

            const viewManager = createViewManager(ctx, masterSessionFile);
            const runId = nextRunId++;
            const runKey = sessionId ? `${sessionId}:${runId}` : null;

            if (runKey) {
                activeRunsBySessionId.set(runKey, { viewManager, startedAt: start });
            }

            // Escape / Ctrl+C abort
            let unsubInput = null;
            if (typeof ctx?.ui?.onTerminalInput === 'function') {
                unsubInput = ctx.ui.onTerminalInput((data) => {
                    if (data === 'escape' || data === 'esc' || data === 'ctrl+c' || data === 'ctrl+d') {
                        signal?.abort?.();
                        return { consume: true };
                    }
                    return undefined;
                });
            }

            try {
                fsm.toActive(); // revising → active (revision callback)
                const results = await executeDAG(plan.nodes, ctx, pi, signal, viewManager);

                // L mode: outer review loop
                let outerRound = 0;
                const MAX_OUTER_ROUNDS = 3;

                while (plan.mode === 'L' && outerRound < MAX_OUTER_ROUNDS) {
                    const anyApproved = results.some((r) => r.status === 'approved');
                    if (!anyApproved) break;

                    const verdict = await runOuterReview(
                        plan.nodes,
                        results,
                        fsm.originalTask,
                        outerRound,
                        ctx,
                        pi,
                        signal,
                        viewManager,
                    );

                    if (verdict.verdict === 'approved') break;

                    outerRound++;
                    if (outerRound >= MAX_OUTER_ROUNDS) break;

                    fsm.toRevising();
                    viewManager.clearWidget();

                    return {
                        content: [
                            {
                                type: 'text',
                                text: [
                                    `## Outer Review — Round ${outerRound} Rejected`,
                                    '',
                                    verdict.feedback,
                                    '',
                                    'Analyze this feedback and call `submit_plan` again with a revised plan.',
                                    'Choose mode M or L based on the remaining work.',
                                    'You MUST call `submit_plan` before ending your turn.',
                                ].join('\n'),
                            },
                        ],
                        details: { results, outerRound },
                    };
                }

                return await finishSquad(results, plan, start, viewManager, pi, fsm);
            } catch (err) {
                await finishSquadCleanup(viewManager, pi, fsm);
                const duration = Date.now() - start;
                return {
                    content: [{ type: 'text', text: `Squad failed · ${duration}ms\n${err.message}` }],
                    details: { error: err.message, durationMs: duration },
                    isError: true,
                };
            } finally {
                if (unsubInput) unsubInput();
                if (runKey) {
                    const run = activeRunsBySessionId.get(runKey);
                    if (run) {
                        for (const rec of run.viewManager.getSessionRecords()) {
                            rec.session = null;
                        }
                    }
                }
            }
        },

        renderCall(args, _renderState, theme) {
            const count = args?.nodes?.length ?? 0;
            const mode = args?.mode ?? '?';
            return {
                render() {
                    return [
                        theme.fg('toolTitle', theme.bold('submit_plan ')) +
                            theme.fg('accent', `${mode} · ${count} node${count !== 1 ? 's' : ''}`),
                    ];
                },
            };
        },

        renderResult(result, _options, theme) {
            const duration = result.details?.durationMs ?? 0;
            if (result.isError) {
                return {
                    render() {
                        return [theme.fg('error', `✖ squad failed · ${duration}ms\n${result.details?.error ?? ''}`)];
                    },
                };
            }
            const status = result.details?.statusText ?? '';
            const mode = result.details?.mode ?? '';
            return {
                render() {
                    return [theme.fg('success', `✔ squad complete · ${mode} · ${duration}ms\n${status}`)];
                },
            };
        },
    });

    registered.add(pi);
}

// ---------------------------------------------------------------------------
// Finish helpers
// ---------------------------------------------------------------------------

async function finishSquad(results, plan, start, viewManager, pi, fsm) {
    fsm.toIdle();
    await pi.setActiveTools(pi.getActiveTools().filter((t) => t !== 'submit_plan'));

    const duration = Date.now() - start;
    const approved = results.filter((r) => r.status === 'approved').length;
    const blocked = results.filter((r) => r.status === 'blocked').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const statusText = [
        approved > 0 ? `${approved} approved` : null,
        blocked > 0 ? `${blocked} blocked` : null,
        failed > 0 ? `${failed} failed` : null,
    ]
        .filter(Boolean)
        .join(', ');

    viewManager.clearWidget();
    return {
        content: [
            {
                type: 'text',
                text: `Squad complete · ${duration}ms\n${statusText}\n\n${JSON.stringify(results, null, 2)}`,
            },
        ],
        details: { results, durationMs: duration, statusText, nodeCount: plan.nodes.length, mode: plan.mode },
    };
}

async function finishSquadCleanup(viewManager, pi, fsm) {
    fsm.toIdle();
    await pi.setActiveTools(pi.getActiveTools().filter((t) => t !== 'submit_plan'));
    viewManager.clearWidget();
}

// ---------------------------------------------------------------------------
// Plan validation
// ---------------------------------------------------------------------------

function validatePlan(params) {
    if (!['M', 'L'].includes(params.mode)) {
        throw new Error('mode must be M or L');
    }
    if (!Array.isArray(params.nodes) || params.nodes.length === 0) {
        throw new Error('nodes required');
    }
    if (params.mode === 'M' && params.nodes.length !== 1) {
        throw new Error('M mode requires exactly 1 node');
    }
    for (const node of params.nodes) {
        if (!node.id || !node.task || !node.review_criteria) {
            throw new Error(`node "${node.id || '?'}" missing required fields`);
        }
    }

    const idSet = new Set(params.nodes.map((n) => n.id));
    for (const node of params.nodes) {
        for (const depId of node.depends_on || []) {
            if (!idSet.has(depId)) {
                throw new Error(`node "${node.id}" depends on unknown node: "${depId}"`);
            }
        }
    }

    return { mode: params.mode, nodes: params.nodes };
}

// ---------------------------------------------------------------------------
// Models config
// ---------------------------------------------------------------------------

function generateModelsConfig(ctx) {
    const available = ctx?.modelRegistry?.getAvailable?.() ?? [];
    if (available.length === 0) return 'No models available for pool config.';

    const config = [];
    for (const m of available) {
        config.push({ provider: m.provider, modelId: m.id, role: 'worker' });
    }

    // Add reviewer entries for fast models
    const fastModels = available.filter(
        (m) =>
            m.role === 'smol' ||
            m.id?.toLowerCase?.()?.includes?.('haiku') ||
            m.id?.toLowerCase?.()?.includes?.('mini') ||
            m.id?.toLowerCase?.()?.includes?.('flash'),
    );
    for (const m of fastModels) {
        config.push({ provider: m.provider, modelId: m.id, role: 'reviewer' });
    }

    saveModelsConfig(config);
    const path = getConfigPath();
    const workerCount = config.filter((c) => c.role === 'worker').length;
    const reviewerCount = config.filter((c) => c.role === 'reviewer').length;
    return `Squad model pool written to ${path}\n${workerCount} worker slot(s), ${reviewerCount} reviewer slot(s).\nDuplicate entries to increase concurrency; edit role/thinkingLevel as needed.`;
}

// ---------------------------------------------------------------------------
// /squad-once: one-shot instruction to a worker session
// ---------------------------------------------------------------------------

async function sendOnceInstruction(args, ctx) {
    if (activeRunsBySessionId.size === 0) {
        ctx.ui.notify('No active squad sessions', 'info');
        return;
    }

    const allWorkers = [];
    for (const [, run] of activeRunsBySessionId) {
        for (const rec of run.viewManager.getSessionRecords()) {
            if (rec.role === 'worker') allWorkers.push(rec);
        }
    }

    if (allWorkers.length === 0) {
        ctx.ui.notify('No active worker sessions', 'info');
        return;
    }

    const options = allWorkers.map((r) => `[W] ${r.nodeId}`);
    const selected = await ctx.ui.select('Send one-shot instruction to:', options);
    if (!selected) return;

    const idx = options.indexOf(selected);
    const worker = allWorkers[idx];
    if (!worker) return;

    const instruction = await ctx.ui.input('Instruction:');
    if (!instruction) return;

    try {
        if (worker.session.isStreaming) {
            worker.session.steer(instruction);
        } else {
            await worker.session.prompt(instruction);
        }
        ctx.ui.notify(`Sent to ${worker.nodeId}: ${instruction.slice(0, 60)}`, 'info');
    } catch (err) {
        ctx.ui.notify(`Failed: ${err.message}`, 'error');
    }
}

// ---------------------------------------------------------------------------
// Session switcher
// ---------------------------------------------------------------------------

async function showSessionSwitcher(ctx) {
    if (activeRunsBySessionId.size === 0) {
        ctx.ui.notify('No active squad sessions to switch to', 'info');
        return;
    }

    const allRecords = [];
    const masterFiles = new Set();
    for (const [, run] of activeRunsBySessionId) {
        for (const rec of run.viewManager.getSessionRecords()) {
            allRecords.push(rec);
        }
        const mf = run.viewManager.getMasterSessionFile?.();
        if (mf) masterFiles.add(mf);
    }

    const options = [];
    const sessionMap = new Map();

    for (const mf of masterFiles) {
        const label = '[Master] Orchestrator';
        options.push(label);
        sessionMap.set(label, { sessionFile: mf, isMaster: true });
    }

    for (const rec of allRecords) {
        const roleTag = rec.role === 'worker' ? 'W' : 'R';
        const label = `[${roleTag}] ${rec.nodeId} - ${rec.role}`;
        options.push(label);
        sessionMap.set(label, { sessionFile: rec.sessionFile, isMaster: false });
    }

    if (options.length === 0) {
        ctx.ui.notify('Squad is running, but no sessions are available to switch to yet.', 'info');
        return;
    }

    const selected = await ctx.ui.select('Squad Sessions — select to switch focus', options);
    if (!selected) return;

    const target = sessionMap.get(selected);
    if (!target) return;

    if (ctx.switchSession) {
        await ctx.switchSession(target.sessionFile);
    } else {
        ctx.ui.notify('Session switching is only available in interactive mode', 'info');
    }
}
