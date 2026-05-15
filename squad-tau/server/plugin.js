/**
 * Squad-Tau Plugin Entry (Event-Sourced Architecture).
 *
 * Registers the delegate tool via pi.registerTool (standard OMP ExtensionAPI),
 * intercepts /squad from terminal via pi.on('input') (matching ../squad/index.js),
 * and starts the HTTP/WS server inline (fire-and-forget).
 *
 * /squad handling:
 * 1. pi.on('input') intercepts /squad <task> from terminal
 * 2. Sends classification prompt to agent via pi.sendMessage()
 * 3. Agent writes plan, calls squad_delegate tool
 * 4. execute handler captures mainSessionId from ctx.sessionManager.getSessionId()
 * 5. processDelegate emits squad:init with mainSessionId in payload
 *
 * This mirrors ../squad where the session ID is captured at tool execution
 * time, not at input time — the EventLog stores it for later use in
 * Architect Awakening (squad:phase_changed → revising).
 *
 * IMPORTANT: OMP ExtensionAPI ignores factory return values (confirmed in
 * src/extensibility/extensions/loader.ts). Tools MUST be registered via
 * pi.registerTool() with execute(toolCallId, params, signal, onUpdate, ctx)
 * where ctx provides sessionManager.getSessionId().
 */
import { processDelegate } from './submit-plan.js';
import { startServer, getGlobalEventLog } from './server-lifecycle.js';
import { project } from '../shared/projections.js';

const PLAN_WRITING_GUIDE = [
    '## Plan Writing Guide',
    '',
    '### Two-phase approach (avoids output truncation)',
    '1. Write a JSON skeleton to a temp file — only fill `id`, `mode`, `reasoning`, and `depends_on`. Leave `task` and `review_criteria` as empty strings or `[]`.',
    '2. Use `jq` to fill in `task` and `review_criteria` for each node, one at a time. Example:',
    '   jq \'.nodes[0].task = "detailed task description"\' plan.json > tmp.json && mv tmp.json plan.json',
    '',
    '### Each node MUST contain in its `task` field:',
    '- **Objective** — what this node accomplishes',
    '- **Acceptance criteria** — concrete, testable conditions that define "done"',
    '- **Reference materials** — file paths, API docs, existing patterns, or code snippets the worker should consult',
    '- **Caveats** — known pitfalls, edge cases, constraints, or things to avoid',
    '',
    '### Each node MUST contain in its `review_criteria` field:',
    '- Specific, checkable assertions — not vague qualities like "good code"',
    '- At least 3 distinct criteria covering correctness, completeness, and edge cases',
].join('\n');

const CLASSIFICATION_PROMPT = [
    '## Squad Task',
    '',
    'Classify this task:',
    '- **M** — multi-file but cohesive, needs review: plan has exactly 1 node.',
    '- **L** — multi-module, strong dependencies, parallel work: plan has multiple nodes with `depends_on`.',
    '',
    PLAN_WRITING_GUIDE,
    '',
    'You MUST write the plan JSON to a temp file using the two-phase approach above, then call `squad_delegate` with the absolute path before ending your turn.',
].join('\n');

let _squadActive = false;

function activateSquad(pi) {
    _squadActive = true;
    const currentTools = pi.getActiveTools();
    if (!currentTools.includes('squad_delegate')) {
        pi.setActiveTools([...currentTools, 'squad_delegate']);
    }
}

function deactivateSquad(pi) {
    _squadActive = false;
    pi.setActiveTools(pi.getActiveTools().filter((t) => t !== 'squad_delegate'));
}

export default function squadPlugin(pi) {
    // ── Register /squad command (matching ../squad/index.js pattern) ──
    pi.registerCommand('squad', {
        description: 'Execute a task via squad with concurrent workers',
        handler: async (args, ctx) => {
            const task = (args ?? '').trim();
            if (!task) {
                ctx.ui.notify('Usage: /squad <task description>', 'info');
                return;
            }
            activateSquad(pi);
            pi.sendMessage(
                {
                    customType: 'squad-activate',
                    content: `${CLASSIFICATION_PROMPT}\n\n${task}`,
                    display: true,
                },
                { triggerTurn: true },
            );
        },
    });

    // ── Intercept /squad from terminal input (matching ../squad/index.js pattern) ──
    pi.on('input', async (event, ctx) => {
        const text = event.text.trim();
        if (!text.startsWith('/squad')) return;
        const spaceIndex = text.indexOf(' ');
        const cmd = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);

        if (cmd !== 'squad') return;

        const task = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim();
        if (!task) {
            ctx.ui.notify('Usage: /squad <task description>', 'info');
            return { handled: true };
        }

        activateSquad(pi);

        // Send classification prompt to the agent (mirrors ../squad handleSquad)
        pi.sendMessage(
            {
                customType: 'squad-activate',
                content: `${CLASSIFICATION_PROMPT}\n\n${task}`,
                display: true,
            },
            { triggerTurn: true },
        );

        return { handled: true };
    });

    // ── Cleanup on session shutdown (matching ../squad/index.js pattern) ──
    pi.on('session_shutdown', async (_event, ctx) => {
        _squadActive = false;
        if (typeof ctx?.ui?.setWidget === 'function') {
            ctx.ui.setWidget('squad_status', undefined);
        }
    });

    // ── Agent end safety net: force revision prompt if squad is in revising phase ──
    // Matches ../squad/index.js where agent_end sends a force message when fsm.isRevising().
    // This handles edge cases where the squad:phase_changed side-effect didn't trigger
    // (e.g., agent ends turn before effect handler completes).
    pi.on('agent_end', async () => {
        if (!_squadActive) return;
        const eventLog = _testEventLog || getGlobalEventLog();
        if (!eventLog) return;
        const state = project(eventLog.log);
        if (state.squad.phase !== 'revising') return;
        pi.sendMessage(
            {
                customType: 'squad-revision-force',
                content: [
                    '[Squad-Tau Architect Awakening — Re-prompt]',
                    '',
                    'You were given feedback to revise your plan but did not call `squad_delegate`.',
                    'Write a revised plan JSON as .toml files in a temp directory, then call `squad_delegate`',
                    'with the absolute path before ending your turn.',
                ].join('\n'),
                display: false,
            },
            { triggerTurn: true },
        );
    });

    // ── Register squad_delegate tool via pi.registerTool (standard OMP ExtensionAPI) ──
    // execute receives (toolCallId, params, signal, onUpdate, ctx)
    // ctx.sessionManager.getSessionId() captures the main session ID
    // (matching ../squad submit_plan pattern)
    pi.registerTool({
        name: 'squad_delegate',
        label: 'Squad Delegate',
        description:
            'Execute a plan via squad (multi-agent DAG orchestration). ' +
            'Write your plan as .toml files in a directory, then pass the directory path. ' +
            'Each .toml file: task = "...", depends_on = [...], [[review_criteria]] with name + description.',
        parameters: {
            type: 'object',
            properties: {
                plan_dir: {
                    type: 'string',
                    description: 'Directory containing .toml node definition files',
                },
            },
            required: ['plan_dir'],
        },
        defaultInactive: true,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            if (!_squadActive) {
                return {
                    content: [{ type: 'text', text: 'Squad is not active. Use /squad to start.' }],
                    isError: true,
                };
            }
            const mainSessionId = ctx?.sessionManager?.getSessionId?.() || null;
            try {
                const result = await processDelegate(params, { mainSessionId });
                return {
                    content: [{ type: 'text', text: result.message }],
                    details: { success: result.success },
                };
            } catch (err) {
                deactivateSquad(pi);
                return {
                    content: [{ type: 'text', text: err.message }],
                    isError: true,
                };
            }
        },
    });

    // Start the WebSocket/HTTP server directly — the OMP loader
    // ignores the factory return value, so return void (matching ExtensionFactory).
    // Fire-and-forget: server initializes asynchronously and is referenced
    // by the global module-level _server in server-lifecycle.js.
    startServer({ pi }).catch((err) => {
        // OMP ExtensionAPI provides pi.logger for error reporting
        pi?.logger?.error?.('Squad-Tau server failed to start', err);
    });
}

// Test helpers: reset squad state between test runs
export function _resetSquadState() {
    _squadActive = false;
}

// Override getGlobalEventLog for testing the agent_end safety net.
// Restore by calling _restoreGlobalEventLog().
let _testEventLog = null;
export function _setTestEventLog(eventLog) {
    _testEventLog = eventLog;
}
export function _restoreGlobalEventLog() {
    _testEventLog = null;
}
