import { validatePlan } from './validate-plan.js';
import fs from 'fs';
import path from 'path';
import { Events } from '../shared/events.js';
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
 * Validates the plan directory, appends SQUAD_INIT to EventLog,
 * and returns immediately. Does NOT wait for SQUAD_COMPLETE —
 * the Engine pulse loop handles all subsequent state transitions.
 */
export async function processDelegate(params) {
    const eventLog = getGlobalEventLog();
    if (!eventLog) throw new Error('EventLog not initialized');

    const { nodes, mode } = readNodesFromDir(params.plan_dir);
    const validation = validatePlan({ mode, nodes });

    if (!validation.valid) {
        throw new Error(`Invalid plan: ${validation.errors.join('; ')}`);
    }

    eventLog.append(Events.SQUAD_INIT, { mode, nodes, originalTask: '' });
    return { success: true, message: 'Squad started' };
}
