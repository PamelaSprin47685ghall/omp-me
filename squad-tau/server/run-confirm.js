import buildConfirmPrompt from './run-confirm-prompt.js';
import { captureFileSnapshots, filesChanged } from './tamper-detection.js';
import { createCounter, CONFIRM_MAX_EMPTY } from './empty-turns.js';

const TOOL_DEFS = {
    confirm: {
        name: 'confirm',
        label: 'Confirm Submission',
        desc: 'Confirm your work passes self-review. Only call after verifying all dimensions.',
        props: { comment: { type: 'string', description: 'Optional confirmation note' } },
        required: [],
    },
    return_work: {
        name: 'return_work',
        label: 'Return Work',
        desc: 'Submit completed work. You MUST call this tool to finish.',
        props: {
            summary: { type: 'string', description: 'Concise description of what you accomplished' },
            affected_files: { type: 'string[]', description: 'Every file you created or modified' },
        },
        required: ['summary', 'affected_files'],
    },
};

export async function runConfirmSession({ pi, sessionId, workerOptions, originalTask, signal, eventBus }) {
    const cwd = workerOptions?.cwd || process.cwd();
    let affectedFiles = workerOptions?.affectedFiles || [];
    let snapshots = await captureFileSnapshots(affectedFiles, cwd);

    while (true) {
        const confirmPrompt = buildConfirmPrompt(originalTask);
        const settledPromise = Promise.withResolvers();
        const tools = buildTools(TOOL_DEFS, settledPromise);

        const emptyCounter = createCounter(CONFIRM_MAX_EMPTY);
        let settled = false;
        let lastToolCallTime = Date.now();

        const unsubscribeSettled = pi.on('session:settled', (data) => {
            if (data.sessionId === sessionId) settledPromise.resolve(data.result);
        });

        const unsubscribeTool = pi.on('session:tool_call', (data) => {
            if (data.sessionId === sessionId) lastToolCallTime = Date.now();
        });

        try {
            pi.sendUserMessage(sessionId, confirmPrompt, { signal, tools });

            while (!settled && !emptyCounter.exceeded()) {
                const raceResult = await Promise.race([
                    settledPromise.promise,
                    waitForActivity(pi, sessionId, signal, 500),
                ]);

                if (raceResult?.settled !== undefined) {
                    if (raceResult.settled) {
                        settled = true;
                        emptyCounter.reset();
                    } else {
                        const idleTime = Date.now() - lastToolCallTime;
                        if (idleTime >= 500) {
                            emptyCounter.increment();
                            if (!emptyCounter.exceeded()) {
                                const nudgeHint = buildNudgeHint();
                                pi.sendUserMessage(sessionId, nudgeHint, { signal, tools });
                            }
                        }
                    }
                }
            }

            if (!settled && emptyCounter.exceeded()) {
                const timeoutHint = buildTimeoutHint();
                pi.sendUserMessage(sessionId, timeoutHint, { signal, tools });
                await waitForSettled(pi, sessionId, signal, 2000);
            }
        } finally {
            unsubscribeSettled();
            unsubscribeTool();
        }

        const result = await settledPromise.promise;

        if (!result) {
            continue;
        }

        if (result.type === 'return_work') {
            affectedFiles = result.affected_files || [];
            snapshots = await captureFileSnapshots(affectedFiles, cwd);
            if (eventBus) eventBus.emit('squad:confirm:resubmit', result);
            continue;
        }

        const changed = await filesChanged(snapshots, cwd);
        if (changed.length > 0) {
            if (eventBus) eventBus.emit('squad:SQUAD_TAMPERED', { files: changed, sessionId });
            snapshots = await captureFileSnapshots(affectedFiles, cwd);
            pi.sendUserMessage(
                sessionId,
                `FILES TAMPERED: ${changed.join(', ')}. Do NOT call confirm. Fix and call return_work({summary, affected_files}).`,
                { signal, tools },
            );
            await waitForSettled(pi, sessionId, signal, 1000);
            continue;
        }

        if (eventBus) eventBus.emit('squad:confirm:approved', result);
        return result;
    }
}

function buildTools(defs, settlePromise) {
    const invokeMap = {
        confirm: (params) => {
            settlePromise.resolve({ approved: true, comment: params?.comment ?? null });
        },
        return_work: (params) => {
            settlePromise.resolve({
                type: 'return_work',
                summary: params.summary,
                affected_files: params.affected_files,
            });
        },
    };

    const executeMap = {
        confirm: (id, params) => {
            invokeMap.confirm(params);
            return { content: [], display: false };
        },
        return_work: (id, params) => {
            invokeMap.return_work(params);
            return { content: [], display: false };
        },
    };

    return Object.values(defs).map((def) => ({
        ...def,
        execute: (id, params) => executeMap[def.name]?.(id, params) ?? { content: [], display: false },
    }));
}

function waitForActivity(pi, sessionId, signal, timeout) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ settled: false }), timeout);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve({ settled: false });
        });
    });
}

function waitForSettled(pi, sessionId, signal, timeout) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, timeout);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

function buildNudgeHint() {
    return [
        'You have not confirmed or resubmitted. If your work is ready, call the `confirm` tool.',
        'If you found issues, fix them and call `return_work` to re-submit.',
        'Remember: any changes invalidate the current submission.',
    ].join('\n');
}

function buildTimeoutHint() {
    return 'Self-review timed out. Call confirm() or return_work() now.';
}
