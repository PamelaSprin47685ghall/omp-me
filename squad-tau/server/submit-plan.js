import { validatePlan } from './validate-plan.js';
import { project } from '../shared/projections.js';
import fs from 'fs';
import path from 'path';
import { getGlobalEventLog } from './server-lifecycle.js';

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
    const tomlFiles = entries.filter((e) => e.endsWith('.toml')).sort();
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
        parsed =
            typeof Bun !== 'undefined' && Bun.TOML
                ? Bun.TOML.parse(content)
                : (() => {
                      throw new Error('TOML parsing requires Bun runtime');
                  })();
    } catch (err) {
        throw new Error(`Invalid TOML in ${file}: ${err.message}`);
    }
    return {
        id: path.basename(file, '.toml'),
        task: parsed.task,
        review_criteria: parsed.review_criteria || [],
        depends_on: parsed.depends_on || [],
    };
}

/**
 * Fire-and-forget plan submission.
 *
 * Validates the plan directory, checks current squad phase:
 * - If squad is in 'revising' phase → emits squad:replan (Big Bang v2: topology overwrite)
 * - Otherwise → emits squad:init (fresh start)
 *
 * Returns immediately. Engine pulse loop handles all subsequent state transitions.
 */
export async function processDelegate(params, options = {}) {
    const mainSessionId = options.mainSessionId || null;

    // ── Absolute path gate ──
    // LLM MUST provide an absolute path under .omp/squad/plans/
    const planDir = params.plan_dir;
    if (!path.isAbsolute(planDir)) {
        throw new Error(
            '`plan_dir` must be an absolute path. You must use the full absolute path, ' +
                'e.g. /home/user/project/.omp/squad/plans/my-task/. Retry with the correct absolute path.',
        );
    }
    const allowedPrefix = path.resolve(process.cwd(), '.omp', 'squad', 'plans');
    if (!path.resolve(planDir).startsWith(allowedPrefix)) {
        throw new Error(
            '`plan_dir` must be located under .omp/squad/plans/. ' +
                'You attempted to use a path outside the allowed directory. Retry with a correct path.',
        );
    }

    // Validate first — catches cycles/missing deps before requiring EventLog
    const { nodes, mode } = readNodesFromDir(planDir);
    const validation = validatePlan({ mode, nodes });
    if (!validation.valid) {
        throw new Error(`Invalid plan: ${validation.errors.join('; ')}`);
    }

    const eventLog = options.eventLog || getGlobalEventLog();
    if (!eventLog) throw new Error('EventLog not initialized');

    // Detect revising phase — if agent is re-planning after outer review rejection,
    // use squad:replan to preserve event history and overwrite only DAG topology.
    // Otherwise it's a fresh start (user typed /squad <new task>):
    // discard old .ndjson and reset EventLog to absolute zero.
    const state = project(eventLog.log);
    if (state.squad.phase === 'revising') {
        eventLog.append('squad:replan', {
            mode,
            nodes,
            originalTask: state.squad.originalTask || '',
            mainSessionId,
        });
    } else {
        eventLog.append('squad:init', {
            mode,
            nodes,
            originalTask: '',
            mainSessionId,
        });
    }

    return { success: true, message: 'Squad started' };
}
