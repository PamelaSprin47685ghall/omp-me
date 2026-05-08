import { executeDAG } from './src/dag-engine.js';
import { createViewManager } from './src/view-manager.js';
import { loadModelsConfig, saveModelsConfig, getConfigPath } from './src/model-pool.js';

const registered = new WeakSet();

const activeRunsBySessionId = new Map();
let nextRunId = 0;

export default async function squadPlugin(pi) {
    if (registered.has(pi)) return;

    try {
        const tool = buildDelegateSquadTool(pi);
        pi.registerTool(tool);

        pi.registerCommand('squad-focus', {
            description: 'Switch focus between squad sessions',
            handler: async (_args, ctx) => {
                await showSessionSwitcher(ctx);
            },
        });

        pi.registerCommand('squad-once', {
            description: 'Send a one-shot instruction to a squad worker session',
            handler: async (args, ctx) => {
                await sendOnceInstruction(args, ctx);
            },
        });

        pi.registerCommand('squad-models', {
            description: 'Generate initial squad model pool config',
            handler: async (_args, ctx) => {
                const result = generateModelsConfig(ctx);
                ctx.ui.notify(result, 'info');
            },
        });

        pi.registerShortcut('ctrl+s', {
            description: 'Switch squad session focus',
            handler: async (ctx) => {
                await showSessionSwitcher(ctx);
            },
        });

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
        });

        registered.add(pi);
    } catch (error) {
        registered.delete(pi);
        throw error;
    }
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
    const sessionId = ctx?.sessionManager?.getSessionId?.();
    let viewManager = null;

    if (sessionId) {
        for (const [key, run] of activeRunsBySessionId) {
            if (key.startsWith(sessionId + ':')) {
                viewManager = run.viewManager;
                break;
            }
        }
    }

    const sessionRecords = viewManager?.getSessionRecords?.() ?? [];
    const workers = sessionRecords.filter((r) => r.role === 'worker');

    if (workers.length === 0) {
        ctx.ui.notify('No active worker sessions', 'info');
        return;
    }

    const options = workers.map((r) => `[W] ${r.nodeId}`);
    const selected = await ctx.ui.select('Send one-shot instruction to:', options);
    if (!selected) return;

    const idx = options.indexOf(selected);
    const worker = workers[idx];
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
    const sessionId = ctx?.sessionManager?.getSessionId?.();

    let viewManager = null;
    if (sessionId) {
        for (const [key, run] of activeRunsBySessionId) {
            if (key.startsWith(sessionId + ':')) {
                viewManager = run.viewManager;
                break;
            }
        }
    }

    const sessionRecords = viewManager?.getSessionRecords?.() ?? [];
    const masterFile = viewManager?.getMasterSessionFile?.();

    if (sessionRecords.length === 0) {
        ctx.ui.notify('No active squad sessions to switch to', 'info');
        return;
    }

    const options = [];
    const sessionMap = new Map();

    if (masterFile) {
        const label = '[Master] Orchestrator';
        options.push(label);
        sessionMap.set(label, { sessionFile: masterFile, isMaster: true });
    }

    for (const rec of sessionRecords) {
        const roleTag = rec.role === 'worker' ? 'W' : 'R';
        const label = `[${roleTag}] ${rec.nodeId} - ${rec.role}`;
        options.push(label);
        sessionMap.set(label, { sessionFile: rec.sessionFile, isMaster: false });
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

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

function buildDelegateSquadTool(pi) {
    return {
        name: 'delegate_squad',
        label: 'Delegate Squad',
        description:
            'Decompose a complex goal into a DAG of sub-tasks. Each task undergoes Worker self-review + Reviewer approval.',
        promptSnippet:
            'Judge task complexity first, then delegate appropriately. Call delegate_squad for medium-large tasks.',
        promptGuidelines: [
            'First, judge the task complexity:',
            '  SMALL (single file, ≤30 lines, no dependencies) — complete it directly without calling delegate_squad',
            '  MEDIUM (multi-file, has dependencies, needs review) — use delegate_squad with 1 node for a review loop',
            '  LARGE (multi-module, strong dependencies, parallel work) — use delegate_squad with a full DAG',
            'Each node must have a unique id, a detailed task, and strict review criteria.',
            'Use depends_on to express execution order — nodes without dependencies run in parallel.',
            'Review criteria must be specific and verifiable (e.g., "all tests pass", "no hardcoded values").',
            'Keep each node focused: one clear deliverable per node.',
        ],

        parameters: {
            type: 'object',
            properties: {
                nodes: {
                    type: 'array',
                    description: 'Array of task nodes forming the DAG',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'Unique task ID (e.g., "db_schema")' },
                            task: { type: 'string', description: 'Detailed instruction for the worker agent' },
                            review_criteria: {
                                type: 'string',
                                description: 'Strict, verifiable criteria the reviewer uses to approve or reject',
                            },
                            depends_on: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'IDs of nodes that must complete before this one starts',
                            },
                        },
                        required: ['id', 'task', 'review_criteria'],
                    },
                },
            },
            required: ['nodes'],
        },

        async execute(_toolCallId, params, signal, onUpdate, ctx) {
            if (typeof ctx?.isSubagent === 'function' && ctx.isSubagent()) {
                return {
                    content: [{ type: 'text', text: 'delegate_squad is not available inside a sub-agent session.' }],
                    details: { error: 'subagent restriction' },
                    isError: true,
                };
            }

            const start = Date.now();
            const sessionId = ctx?.sessionManager?.getSessionId?.();
            const masterSessionFile = ctx?.sessionManager?.getSessionFile?.() ?? null;

            const viewManager = createViewManager(ctx, masterSessionFile);
            const runId = nextRunId++;
            const runKey = sessionId ? `${sessionId}:${runId}` : null;

            if (runKey) {
                activeRunsBySessionId.set(runKey, { viewManager, startedAt: start });
            }

            // Register Escape/Ctrl+C for global abort during squad execution
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
                const results = await executeDAG(params.nodes, ctx, pi, signal, viewManager);
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
                            text: `Squad complete \u00B7 ${duration}ms\n${statusText}\n\n${JSON.stringify(results, null, 2)}`,
                        },
                    ],
                    details: { results, durationMs: duration, statusText, nodeCount: params.nodes.length },
                };
            } catch (err) {
                viewManager.clearWidget();

                const duration = Date.now() - start;
                return {
                    content: [{ type: 'text', text: `Squad failed \u00B7 ${duration}ms\n${err.message}` }],
                    details: { error: err.message, durationMs: duration },
                    isError: true,
                };
            } finally {
                if (unsubInput) unsubInput();
                if (runKey) {
                    activeRunsBySessionId.delete(runKey);
                }
            }
        },

        renderCall(args, _renderState, theme) {
            const count = args?.nodes?.length ?? 0;
            return {
                render() {
                    return [
                        theme.fg('toolTitle', theme.bold('delegate_squad ')) + theme.fg('accent', `${count} nodes`),
                    ];
                },
            };
        },

        renderResult(result, _options, theme) {
            const duration = result.details?.durationMs ?? 0;
            if (result.isError) {
                return {
                    render() {
                        return [
                            theme.fg(
                                'error',
                                `\u2716 squad failed \u00B7 ${duration}ms\n${result.details?.error ?? ''}`,
                            ),
                        ];
                    },
                };
            }
            const status = result.details?.statusText ?? '';
            return {
                render() {
                    return [theme.fg('success', `\u2714 squad complete \u00B7 ${duration}ms\n${status}`)];
                },
            };
        },
    };
}
