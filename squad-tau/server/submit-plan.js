import { validatePlan } from './validate-plan.js';
import { runOuterReview } from './outer-review.js';
import fs from 'fs';
import path from 'path';

function readNodesFromDir(plan_dir) {
    const tomlFiles = listTomlFiles(plan_dir);
    const nodes = tomlFiles.map((file) => parseTomlNode(plan_dir, file));
    const mode = nodes.length === 1 ? 'M' : 'L';
    return { nodes, mode };
}

function listTomlFiles(plan_dir) {
    let entries;
    try {
        entries = fs.readdirSync(plan_dir);
    } catch (err) {
        throw new Error(`Failed to read plan_dir: ${err.message}`);
    }
    const tomlFiles = entries.filter((e) => e.endsWith('.toml'));
    if (tomlFiles.length === 0) {
        throw new Error(`No .toml files found in ${plan_dir}`);
    }
    return tomlFiles;
}

function parseTomlNode(plan_dir, file) {
    const filePath = path.join(plan_dir, file);
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        throw new Error(`Failed to read ${file}: ${err.message}`);
    }
    let parsed;
    try {
        parsed = Bun.TOML.parse(content);
    } catch (err) {
        throw new Error(`Invalid TOML in ${file}: ${err.message}`);
    }
    return {
        id: path.basename(file, '.toml'),
        task: parsed.task,
        depends_on: parsed.depends_on || [],
        review_criteria: parsed.review_criteria || [],
    };
}

function buildNodeResults(results) {
    return results.map((r) => ({
        id: r.nodeId,
        status: r.status,
        summary: r.summary || '',
        affectedFiles: r.affectedFiles || [],
    }));
}

async function runOuterReviewLoop({ nodeResults, originalTask, ctx, pi, signal, eventBus, modelPool, startTime, fsm }) {
    let outerRound = 1;
    while (true) {
        const result = await runOuterReview(
            nodeResults,
            originalTask,
            outerRound,
            ctx,
            pi,
            signal,
            eventBus,
            modelPool,
            startTime,
        );
        if (!result) {
            eventBus?.emit('squad', 'abort', { reason: 'Outer review aborted' });
            return { done: true, payload: { success: false, message: 'Outer review was aborted.' } };
        }
        if (result.approved) return { done: false };
        const feedback = result.reason || 'Revise and resubmit.';
        return {
            done: true,
            payload: {
                success: true,
                outerReviewRejected: true,
                outerRound,
                feedback,
                message: `Outer review rejected (round ${outerRound}). Feedback: ${feedback}`,
            },
        };
    }
}

async function finalize({
    results,
    mode,
    nodes,
    fsm,
    startTime,
    onComplete,
    originalTask,
    ctx,
    pi,
    signal,
    eventBus,
    modelPool,
}) {
    const nodeResults = buildNodeResults(results);
    if (mode === 'L') {
        const review = await runOuterReviewLoop({
            nodeResults,
            originalTask,
            ctx,
            pi,
            signal,
            eventBus,
            modelPool,
            startTime,
            fsm,
        });
        if (review.done) return review.payload;
    }
    fsm.deactivate();
    const duration = Date.now() - startTime;
    if (onComplete) onComplete({ results: nodeResults, mode, nodes, durationMs: duration });
    return {
        success: true,
        results: nodeResults,
        message: `Squad completed successfully in ${(duration / 1000).toFixed(1)}s`,
    };
}

function createDelegateHandler(deps) {
    return {
        name: 'delegate',
        description: 'Delegate execution by reading plan nodes from a directory of .toml files',
        parameters: {
            type: 'object',
            properties: {
                plan_dir: { type: 'string', description: 'Directory containing .toml node definition files' },
            },
            required: ['plan_dir'],
        },
        handler: async ({ plan_dir }) => {
            const { fsm, eventBus, originalTask } = deps;
            const currentState = fsm.getState();
            if (currentState !== 'active') {
                throw new Error(`Cannot delegate in state: ${currentState}. Must be active.`);
            }
            const { nodes, mode } = readNodesFromDir(plan_dir);
            validatePlan({ mode, nodes });
            if (eventBus) eventBus.emit('squad', 'init', { mode, nodes, originalTask: originalTask || '' });
            return await runDelegate({ nodes, mode, ...deps });
        },
    };
}

async function runDelegate(deps) {
    const { nodes, mode, executeDAG, ctx, pi, signal, eventBus, modelPool, fsm, startTime, onComplete } = deps;
    try {
        const results = await executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool });
        return await finalize({ results, ...deps });
    } catch (error) {
        const results = nodes.map((n) => ({
            nodeId: n.id,
            status: 'failed',
            summary: error.message,
            affectedFiles: [],
        }));
        const nodeResults = results.map((r) => ({
            id: r.nodeId,
            status: r.status,
            summary: r.summary,
            affectedFiles: r.affectedFiles,
        }));

        if (eventBus) {
            eventBus.emit('squad', 'complete', {
                success: false,
                results: nodeResults,
                message: `DAG execution failed: ${error.message}`,
            });
        }
        fsm.deactivate();
        const duration = Date.now() - startTime;
        if (onComplete) onComplete({ results: nodeResults, mode, nodes, durationMs: duration });

        throw new Error(`DAG execution failed: ${error.message}`);
    }
}

export { createDelegateHandler };
