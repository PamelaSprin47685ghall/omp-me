import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { STATUS, EVENT, transition, emptyState, MAX_RETRIES } from './state-machine.js';

const OMP_BASE = join(homedir(), '.bun/install/global/node_modules/@oh-my-pi');
const CODING_AGENT_PATH = 'file://' + join(OMP_BASE, 'pi-coding-agent/src/index.ts');

const MAX_EMPTY_TURNS = 20;
const CONFIRM_MAX_EMPTY = 5;

// ---------------------------------------------------------------------------
// Higher-order tool factory — eliminates boilerplate in lifecycle tools
// ---------------------------------------------------------------------------

function createLifecycleTool(spec, onInvoke) {
    return {
        name: spec.name,
        label: spec.label,
        description: spec.desc,
        parameters: {
            type: 'object',
            properties: spec.props,
            ...(spec.required?.length > 0 ? { required: spec.required } : {}),
        },
        async execute(_id, params, _sig, _upd, childCtx) {
            onInvoke(params);
            childCtx?.abort?.();
            return { content: [], display: false };
        },
    };
}

const RTN_WORK = {
    name: 'return_work',
    label: 'Return Work',
    desc: 'Submit completed work. You MUST call this tool to finish.',
    props: {
        summary: { type: 'string', description: 'What you accomplished' },
        affected_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files you modified or created',
        },
    },
    required: ['summary', 'affected_files'],
};

const CNF = {
    name: 'confirm',
    label: 'Confirm Submission',
    desc: 'Confirm your work passes self-review. Only call after verifying all dimensions.',
    props: {
        comment: { type: 'string', description: 'Optional confirmation note' },
    },
    required: [],
};

const APPR = {
    name: 'approve',
    label: 'Approve',
    desc: 'Approve the work — it meets all review criteria.',
    props: {
        comment: { type: 'string', description: 'Optional approval note' },
    },
    required: [],
};

const REJ = {
    name: 'reject',
    label: 'Reject',
    desc: 'Reject the work with specific, actionable feedback.',
    props: {
        feedback: {
            type: 'string',
            description: 'Specific feedback describing what must be fixed',
        },
    },
    required: ['feedback'],
};

// ---------------------------------------------------------------------------
// File integrity helpers for confirming-phase tamper detection
// ---------------------------------------------------------------------------

function captureFileSnapshots(files, cwd) {
    const snapshots = {};
    for (const file of files) {
        try {
            snapshots[file] = statSync(join(cwd, file)).mtimeMs;
        } catch {
            snapshots[file] = -1;
        }
    }
    return snapshots;
}

function filesChanged(snapshots, cwd) {
    for (const [file, mtime] of Object.entries(snapshots)) {
        try {
            if (statSync(join(cwd, file)).mtimeMs !== mtime) return true;
        } catch {
            if (mtime !== -1) return true;
        }
    }
    return false;
}

const BUILT_IN_REVIEW_DIMENSIONS = [
    '1. Code Quality — is the code correct, clear, and idiomatic?',
    '2. Design Flaws — are there architectural problems, tight coupling, or missing abstractions?',
    '3. Security Vulnerabilities — injection, auth bypass, data leaks, unsafe defaults?',
    '4. User Experience — will the caller or downstream consumer understand and use this correctly?',
    '5. Goal Completeness — does this deliverable fully satisfy the task?',
];

let _codingAgentMod = null;
async function getCodingAgentMod() {
    if (!_codingAgentMod) {
        _codingAgentMod = await import(CODING_AGENT_PATH);
    }
    return _codingAgentMod;
}

// ---------------------------------------------------------------------------
// Session options builders
// ---------------------------------------------------------------------------

function buildBaseSessionOptions(ctx, pi, modelSlot) {
    const options = {
        cwd: ctx?.cwd ?? process.cwd(),
        hasUI: false,
        disableExtensionDiscovery: true,
    };

    // 继承父会话的 AGENTS.md 搜索和 workspace tree，避免 subagent 重新扫描
    if (ctx?.agentsMdSearch) options.agentsMdSearch = ctx.agentsMdSearch;
    if (ctx?.workspaceTree) options.workspaceTree = ctx.workspaceTree;

    if (ctx?.modelRegistry) options.modelRegistry = ctx.modelRegistry;
    if (ctx?.model) options.model = ctx.model;

    if (modelSlot) {
        const available = ctx?.modelRegistry?.getAvailable?.() ?? [];
        const matched = available.find((m) => m.provider === modelSlot.provider && m.id === modelSlot.id);
        if (matched) {
            options.model = matched;
            if (modelSlot.thinkingLevel) options.thinkingLevel = modelSlot.thinkingLevel;
        }
    }

    if (ctx?.getThinkingLevel) {
        const level = ctx.getThinkingLevel();
        if (level && !options.thinkingLevel) options.thinkingLevel = level;
    }

    if (ctx?.getSystemPrompt) {
        options.systemPrompt = ctx.getSystemPrompt();
    }

    // 不传 eventBus——subagent 用自己的 EventBus
    // 事件转发在 runSession 中用 session.subscribe + pi.events 处理

    return options;
}

function buildWorkerSessionOptions(ctx, pi, modelSlot) {
    const options = buildBaseSessionOptions(ctx, pi, modelSlot);

    const activeTools = (ctx?.session?.getActiveToolNames?.() ?? pi?.getActiveTools?.())?.filter(
        (t) => t !== 'delegate_squad',
    );
    if (activeTools?.length > 0) options.toolNames = activeTools;

    return options;
}

function buildReviewerSessionOptions(ctx, pi, modelSlot) {
    const options = buildBaseSessionOptions(ctx, pi, modelSlot);
    options.toolNames = ['read', 'search', 'find', 'lsp', 'bash'];
    return options;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildWorkerPrompt(node, upstreamResults, reviewerFeedback) {
    const lines = [`## Task\n${node.task}`];

    if (upstreamResults && upstreamResults.length > 0) {
        lines.push('\n## Context from Upstream Tasks');
        for (const upstream of upstreamResults) {
            const fileList = (upstream.affected_files || []).join(', ');
            lines.push(`- **${upstream.id}**: ${upstream.summary}`);
            if (fileList) lines.push(`  Files: ${fileList}`);
        }
        lines.push('\nUse the `read` tool to inspect upstream files as needed.');
    }

    if (reviewerFeedback) {
        lines.push('\n## Reviewer Feedback from Previous Attempt');
        lines.push(reviewerFeedback);
        lines.push('\nAddress every issue listed above before resubmitting.');
    }

    lines.push(
        '\n---',
        'Complete this task. When finished, you MUST call the `return_work` tool with:',
        '- `summary`: concise description of what you accomplished',
        '- `affected_files`: every file you created or modified',
        '',
        'Do NOT output prose to signal completion — only the tool call counts.',
    );

    return lines.join('\n');
}

function buildConfirmPrompt(workerResult) {
    const fileList = (workerResult.affected_files || []).join(', ');
    const dimensions = BUILT_IN_REVIEW_DIMENSIONS.join('\n');

    return [
        '## Self-Review — Confirm Your Submission',
        '',
        `You submitted: **${workerResult.summary}**`,
        `Files: ${fileList || '(none)'}`,
        '',
        'Before a reviewer inspects your work, verify it yourself against these dimensions:',
        '',
        dimensions,
        '',
        '---',
        'You may use tools to re-read files, run tests, or fix issues.',
        '',
        'When you are confident your submission passes ALL dimensions above, call the `confirm` tool.',
        '',
        'CRITICAL: If you make ANY changes during this self-review, you have invalidated your submission.',
        'You MUST then call `return_work` again with the updated summary and files.',
        'DO NOT call `confirm` after making changes — re-submit first.',
    ].join('\n');
}

function buildConfirmReminder() {
    return [
        'You have not confirmed or resubmitted. If your work is ready, call the `confirm` tool.',
        'If you found issues, fix them and call `return_work` to re-submit.',
        'Remember: any changes invalidate the current submission.',
    ].join('\n');
}

function buildReviewerPrompt(node, workerResult) {
    const fileList = (workerResult.affected_files || []).join(', ');
    const dimensions = BUILT_IN_REVIEW_DIMENSIONS.join('\n');

    return [
        '## Review Task',
        `**Original task**: ${node.task}`,
        '',
        '## Worker Submission (self-reviewed)',
        `**Summary**: ${workerResult.summary}`,
        `**Affected files**: ${fileList || '(none)'}`,
        '',
        '## Review Criteria',
        Array.isArray(node.review_criteria)
            ? node.review_criteria.map((c) => `- ${c}`).join('\n')
            : node.review_criteria,
        '',
        '## Built-in Review Dimensions',
        dimensions,
        '',
        '---',
        'You are a code reviewer. Use the `read` tool to inspect affected files and `bash` to run tests if needed.',
        'If the work meets ALL criteria above (both user-specified and built-in), call the `approve` tool.',
        'If any criterion is not met, call the `reject` tool with specific, actionable feedback.',
        'Do NOT write or modify any code. Your job is to review, not to fix.',
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Dynamic tool builders
// ---------------------------------------------------------------------------

function buildReturnWorkTool(resolve) {
    return createLifecycleTool(RTN_WORK, (p) =>
        resolve({ summary: p.summary, affected_files: p.affected_files || [] }),
    );
}

function buildConfirmTool(resolve) {
    return createLifecycleTool(CNF, (p) => resolve({ confirmed: true, comment: p.comment }));
}

function buildApproveTool(resolve) {
    return createLifecycleTool(APPR, (p) => resolve({ verdict: 'approved', comment: p.comment }));
}

function buildRejectTool(resolve) {
    return createLifecycleTool(REJ, (p) => resolve({ verdict: 'rejected', feedback: p.feedback }));
}

// ---------------------------------------------------------------------------
// Session lifecycle helper
// ---------------------------------------------------------------------------

async function runSession(pi, options, promptText, signal, toolBuilders, nudgeHint, onSessionCreated) {
    const DIAG = (msg) => { try { require('fs').appendFileSync('/tmp/squad-diag.log', `${Date.now()} ${msg}\n`); } catch {} };
    DIAG('runSession start');

    const createAgentSession = pi?.pi?.createAgentSession;
    if (!createAgentSession) {
        throw new Error('squad: createAgentSession unavailable — is the coding-agent loaded?');
    }
    DIAG('createAgentSession found');

    DIAG('loading getCodingAgentMod...');
    const { SessionManager } = await getCodingAgentMod();
    DIAG('SessionManager loaded');

    const childAbort = new AbortController();
    let settled = false;

    const tools = toolBuilders.map((buildFn) => {
        const tool = buildFn();
        const originalExecute = tool.execute;
        tool.execute = async (...args) => {
            settled = true;
            return originalExecute(...args);
        };
        return tool;
    });

    if (signal) {
        signal.addEventListener(
            'abort',
            () => {
                childAbort.abort();
            },
            { once: true },
        );
    }

    let session = null;
    let unsub = null;

    try {
        DIAG('creating SessionManager...');
        const sessionOpts = {
            ...options,
            customTools: tools,
            sessionManager: SessionManager.create(options.cwd),
        };
        DIAG('SessionManager created, cwd=' + options.cwd);

        DIAG('calling createAgentSession...');
        const factoryResult = await createAgentSession(sessionOpts);
        DIAG('createAgentSession returned');
        session = factoryResult.session;

        if (onSessionCreated) {
            onSessionCreated(session);
        }

        // 直接使用主 session 的 EventBus (pi.events) 进行事件转发
        const mainEventBus = pi?.events;
        if (mainEventBus) {
            unsub = session.subscribe((event) => {
                mainEventBus.emit('squad:subagent:stream', {
                    sessionFile: session.sessionFile,
                    event,
                });
            });
        }

        DIAG('calling session.prompt...');
        DIAG('session.model=' + (session.model?.provider + '/' + session.model?.id || 'null'));
        DIAG('session.sessionId=' + session.sessionId);
        const promptPromise = session.prompt(promptText);
        const timeoutMs = 30000;
        const timeoutPromise = Bun.sleep(timeoutMs).then(() => {
            throw new Error('session.prompt timed out after ' + timeoutMs + 'ms');
        });
        try {
            await Promise.race([promptPromise, timeoutPromise]);
            DIAG('session.prompt returned');
        } catch (e) {
            DIAG('session.prompt ERROR: ' + e.message);
            throw e;
        }

        let emptyTurnCount = 0;
        while (!settled && emptyTurnCount < MAX_EMPTY_TURNS) {
            if (childAbort.signal.aborted) break;

            while (session.isStreaming) {
                await new Promise((r) => setTimeout(r, 200));
                if (settled || childAbort.signal.aborted) break;
            }

            if (settled || childAbort.signal.aborted) break;

            emptyTurnCount++;
            const msg = nudgeHint
                ? nudgeHint
                : 'ERROR: You must call the required tool to finish this session. Do not output prose — call the tool.';
            await session.prompt(msg);
        }

        if (!settled) {
            throw new Error(`Session ended without calling the required tool after ${emptyTurnCount} nudges`);
        }

        return session;
    } catch (err) {
        session?.abort?.();
        throw err;
    } finally {
        childAbort.abort();
        unsub?.();
    }
}

// ---------------------------------------------------------------------------
// Confirming session — opens worker's session file with confirm tools
// ---------------------------------------------------------------------------

async function runConfirmSession(pi, workerOptions, confirmPrompt, signal, toolBuilders) {
    const createAgentSession = pi?.pi?.createAgentSession;
    if (!createAgentSession) {
        throw new Error('squad: createAgentSession unavailable');
    }

    const { SessionManager } = await getCodingAgentMod();

    const childAbort = new AbortController();
    let settled = false;

    const tools = toolBuilders.map((buildFn) => {
        const tool = buildFn();
        const originalExecute = tool.execute;
        tool.execute = async (...args) => {
            settled = true;
            return originalExecute(...args);
        };
        return tool;
    });

    if (signal) {
        signal.addEventListener(
            'abort',
            () => {
                childAbort.abort();
            },
            { once: true },
        );
    }

    let session = null;
    let unsub = null;

    try {
        const sessionOpts = {
            ...workerOptions,
            customTools: tools,
            sessionManager: await SessionManager.open(workerOptions.sessionFile),
        };

        const factoryResult = await createAgentSession(sessionOpts);
        session = factoryResult.session;

        // Forward subagent streaming events to main session's EventBus
        if (workerOptions.eventBus) {
            unsub = session.subscribe((event) => {
                workerOptions.eventBus.emit('squad:subagent:stream', {
                    sessionFile: session.sessionFile,
                    event,
                });
            });
        }

        await session.prompt(confirmPrompt);

        let emptyTurnCount = 0;
        while (!settled && emptyTurnCount < CONFIRM_MAX_EMPTY) {
            if (childAbort.signal.aborted) break;

            while (session.isStreaming) {
                await new Promise((r) => setTimeout(r, 200));
                if (settled || childAbort.signal.aborted) break;
            }

            if (settled || childAbort.signal.aborted) break;

            emptyTurnCount++;
            await session.prompt(buildConfirmReminder());
        }

        if (!settled) {
            throw new Error('Self-review timed out without confirmation');
        }
    } catch (err) {
        session?.abort?.();
        throw err;
    } finally {
        childAbort.abort();
        unsub?.();
    }
}

// ---------------------------------------------------------------------------
// Public API: Worker runner (authoring → confirming)
// ---------------------------------------------------------------------------

async function runWorker(node, upstreamResults, reviewerFeedback, ctx, pi, signal, viewManager, modelSlot) {
    const { promise: workPromise, resolve: workResolve } = Promise.withResolvers();

    const options = buildWorkerSessionOptions(ctx, pi, modelSlot);
    const promptText = buildWorkerPrompt(node, upstreamResults, reviewerFeedback);

    const session = await runSession(
        pi,
        options,
        promptText,
        signal,
        [() => buildReturnWorkTool(workResolve)],
        null,
        (s) => viewManager.registerSession(node.id, 'worker', s.sessionFile, s),
    );

    let workerResult = await workPromise;

    // Confirming loop — worker may fix issues and re-submit multiple times
    while (true) {
        viewManager.updateNodeState(node.id, STATUS.CONFIRMING);
        ctx?.ui?.notify?.(`[squad] ⟳ node '${node.id}' confirming`, 'info');

        const { promise: confirmPromise, resolve: confirmResolve } = Promise.withResolvers();
        const { promise: resubmitPromise, resolve: resubmitResolve } = Promise.withResolvers();

        const confirmPrompt = buildConfirmPrompt(workerResult);
        const confirmOptions = { ...options, sessionFile: session.sessionFile };
        const fileSnapshots = captureFileSnapshots(workerResult.affected_files || [], options.cwd);

        await runConfirmSession(pi, confirmOptions, confirmPrompt, signal, [
            () => {
                const tool = buildConfirmTool(confirmResolve);
                const originalExecute = tool.execute;
                tool.execute = async (id, params, sig, upd, childCtx) => {
                    if (filesChanged(fileSnapshots, options.cwd)) {
                        confirmResolve({ confirmed: true, tampered: true });
                        childCtx?.abort?.();
                        return { content: [], display: false };
                    }
                    return originalExecute(id, params, sig, upd, childCtx);
                };
                return tool;
            },
            () => buildReturnWorkTool(resubmitResolve),
        ]);

        const result = await Promise.race([
            confirmPromise.then((r) => ({ type: 'confirm', ...r })),
            resubmitPromise.then((r) => ({ type: 'resubmit', ...r })),
        ]);

        if (result.type === 'confirm') {
            if (result.tampered) {
                const err = new Error('FILES TAMPERED: files were modified during self-review.');
                err.code = 'SQUAD_TAMPERED';
                throw err;
            }
            return { ...workerResult, sessionFile: session.sessionFile, session };
        }

        // Worker called return_work during confirming — update and loop back
        workerResult = { summary: result.summary, affected_files: result.affected_files || [] };
    }
}

// ---------------------------------------------------------------------------
// Public API: Reviewer runner
// ---------------------------------------------------------------------------

async function runReviewer(node, workerResult, ctx, pi, signal, viewManager, modelSlot) {
    const { promise, resolve } = Promise.withResolvers();

    const options = buildReviewerSessionOptions(ctx, pi, modelSlot);
    const promptText = buildReviewerPrompt(node, workerResult);

    const session = await runSession(
        pi,
        options,
        promptText,
        signal,
        [() => buildApproveTool(resolve), () => buildRejectTool(resolve)],
        null,
        (s) => viewManager.registerSession(node.id, 'reviewer', s.sessionFile, s),
    );

    const reviewResult = await promise;

    return { ...reviewResult, sessionFile: session.sessionFile, session };
}

// ---------------------------------------------------------------------------
// Public API exports for outer review loop
// ---------------------------------------------------------------------------

export { runSession, buildReviewerSessionOptions, buildApproveTool, buildRejectTool };

// ---------------------------------------------------------------------------
// Public API: single node execution (state machine driven)
// ---------------------------------------------------------------------------

export async function runNode(node, upstreamResults, ctx, pi, signal, viewManager, modelPool) {
    let state = emptyState(node.id);
    state = transition(state, { type: EVENT.START, retryCount: 0 });
    viewManager.updateNodeState(node.id, state.status, { retryCount: state.retryCount });
    ctx?.ui?.notify?.(`[squad] ⟳ node '${node.id}' authoring`, 'info');

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (signal?.aborted) {
            state = transition(state, { type: EVENT.ABORT });
            viewManager.updateNodeState(node.id, state.status);
            return { id: node.id, status: state.status, summary: 'Aborted', affected_files: [] };
        }

        let workerSlot = null;
        let reviewerSlot = null;

        if (modelPool) {
            try {
                workerSlot = await modelPool.acquire('worker', signal);
            } catch {
                break;
            }
        }

        try {
            // Phase 1: Authoring
            const workerResult = await runWorker(
                node,
                upstreamResults,
                state.lastFeedback,
                ctx,
                pi,
                signal,
                viewManager,
                workerSlot,
            );

            state = transition(state, {
                type: EVENT.WORKER_SUBMIT,
                summary: workerResult.summary,
                files: workerResult.affected_files,
            });
            viewManager.updateNodeState(node.id, state.status);

            // Phase 2: Reviewing
            state = transition(state, { type: EVENT.CONFIRM });
            viewManager.updateNodeState(node.id, state.status, { retryCount: attempt });
            ctx?.ui?.notify?.(
                `[squad] ⟳ node '${node.id}' reviewing (${state.retryCount > 0 ? 'R' + (state.retryCount + 1) : 'R1'})`,
                'info',
            );

            if (modelPool) {
                try {
                    reviewerSlot = await modelPool.acquire('reviewer', signal);
                } catch {
                    break;
                }
            }

            const reviewResult = await runReviewer(node, workerResult, ctx, pi, signal, viewManager, reviewerSlot);

            if (reviewResult.verdict === 'approved') {
                state = transition(state, { type: EVENT.APPROVE });
                viewManager.updateNodeState(node.id, state.status);
                ctx?.ui?.notify?.(`[squad] ✓ node '${node.id}' approved`, 'success');
                return {
                    id: node.id,
                    status: state.status,
                    summary: workerResult.summary,
                    affected_files: workerResult.affected_files,
                    workerSessionFile: workerResult.sessionFile,
                    reviewerSessionFile: reviewResult.sessionFile,
                };
            }

            // Rejected — update state for retry
            state = transition(state, {
                type: EVENT.REJECT,
                feedback: reviewResult.feedback,
                maxRetries: MAX_RETRIES,
            });

            viewManager.updateNodeState(node.id, state.status, { retryCount: state.retryCount });

            if (state.status === STATUS.AUTHORING) {
                ctx?.ui?.notify?.(`[squad] ⟳ node '${node.id}' retry (R${state.retryCount}) due to Reject`, 'warn');
            }

            if (state.status === STATUS.BLOCKED) {
                ctx?.ui?.notify?.(`[squad] ⚠ node '${node.id}' blocked after ${MAX_RETRIES} retries`, 'error');
                return {
                    id: node.id,
                    status: state.status,
                    summary: `Rejected ${MAX_RETRIES + 1} times. Last: ${state.lastFeedback}`,
                    affected_files: [],
                };
            }
        } catch (err) {
            if (err.code === 'SQUAD_TAMPERED') {
                state = transition(state, {
                    type: EVENT.REJECT,
                    feedback:
                        'FILES TAMPERED: You modified files during self-review. This is FORBIDDEN. Re-do the work and submit cleanly — do NOT modify files after calling return_work.',
                    maxRetries: MAX_RETRIES,
                });
            } else {
                state = transition(state, {
                    type: EVENT.SESSION_ERROR,
                    error: err.message,
                    maxRetries: MAX_RETRIES,
                });
            }

            viewManager.updateNodeState(node.id, state.status, { retryCount: state.retryCount });

            if (state.status === STATUS.AUTHORING) {
                ctx?.ui?.notify?.(
                    `[squad] ⟳ node '${node.id}' retry (R${state.retryCount}) due to ${err.code === 'SQUAD_TAMPERED' ? 'Tamper' : 'SessionError'}`,
                    'warn',
                );
            }

            if (state.status === STATUS.FAILED || state.status === STATUS.BLOCKED) {
                ctx?.ui?.notify?.(`[squad] ✖ node '${node.id}' ${state.status}`, 'error');
                return { id: node.id, status: state.status, summary: err.message, affected_files: [] };
            }
        } finally {
            workerSlot?.release?.();
            reviewerSlot?.release?.();
        }
    }

    // Should not reach here — handled by REJECT/SESSION_ERROR above
    return { id: node.id, status: STATUS.FAILED, summary: 'Unexpected exit', affected_files: [] };
}
