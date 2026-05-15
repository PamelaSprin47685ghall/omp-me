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
import { startServer } from './server-lifecycle.js';

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

export default function squadPlugin(pi) {
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
        defaultInactive: false,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const mainSessionId = ctx?.sessionManager?.getSessionId?.() || null;
            try {
                const result = await processDelegate(params, { mainSessionId });
                return {
                    content: [{ type: 'text', text: result.message }],
                    details: { success: result.success },
                };
            } catch (err) {
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
    startServer({ pi }).catch(() => {});
}
