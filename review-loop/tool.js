/**
 * loop_control tool — content generation, definition, and TUI rendering.
 */

import { isInactiveOrDone } from './state.js';
import { buildConfirmMessage, buildNextMessage, buildDoneMessage } from './messages.js';

export function handleLoopControlTool(params, state) {
    if (isInactiveOrDone(state)) {
        return { content: [{ type: 'text', text: 'No active loop.' }] };
    }

    if (params.status === 'done') {
        return {
            content: [
                {
                    type: 'text',
                    text:
                        state.status === 'running'
                            ? buildConfirmMessage(state)
                            : buildDoneMessage(state, params.summary),
                },
            ],
        };
    }

    return { content: [{ type: 'text', text: buildNextMessage(state, params.summary) }] };
}

export function getLoopControlToolDefinition(typebox, StringEnum) {
    return {
        name: 'loop_control',
        label: 'Loop Control',
        description:
            "Signal loop progress. Call this when you finish a loop iteration. status 'next' to advance, 'done' to finish.",
        parameters: typebox.Object({
            status: StringEnum(['next', 'done'], { description: 'Whether to continue or mark done' }),
            summary: typebox.String({ description: 'Brief summary of what was accomplished this iteration' }),
        }),
    };
}

export function createRenderCall(Text) {
    return (args, theme) =>
        new Text(
            theme.fg('toolTitle', theme.bold('loop_control ')) +
                theme.fg(args.status === 'done' ? 'success' : 'accent', args.status),
            0,
            0,
        );
}

export function createRenderResult(Text) {
    return (result, _opts, theme) => {
        const d = result.details;
        if (!d) return new Text('', 0, 0);
        if (d.status === 'done') {
            const s = d.lastSummary ? ` ${d.lastSummary}` : '';
            const r = d.reasonDone ? `: ${d.reasonDone}` : '';
            return new Text(theme.fg('success', `✓ done${s}${r}`), 0, 0);
        }
        if (d.status === 'confirming') {
            const r = d.reasonDone ? `: ${d.reasonDone}` : '';
            const summary = d.lastSummary ? `\n${d.lastSummary}` : '';
            return new Text(theme.fg('accent', `? confirm done${summary}${r}`), 0, 0);
        }
        if (d.status === 'running') {
            const s = d.lastSummary ? ` ${d.lastSummary}` : '';
            return new Text(theme.fg('accent', `→ step ${d.step + 1}${s}`), 0, 0);
        }
        return new Text('', 0, 0);
    };
}
