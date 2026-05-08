/**
 * block-head-tail — oh-my-pi extension that strips | head -nXXX and | tail -nXXX
 * from bash tool commands. LLMs frequently pipe to head/tail as a crude truncation,
 * causing the agent to miss important output.
 */

const HEAD_TAIL_PIPE = /\s*\|\s*(head|tail)\s+-n\s*\d+\s*/g;

const registered = new WeakSet();

export default async function blockHeadTailExtension(pi) {
    if (registered.has(pi)) return;

    pi.on('tool_call', (event, ctx) => {
        if (event.toolName !== 'bash') return;

        const cmd = event.input?.command;
        if (typeof cmd !== 'string') return;

        const original = cmd;
        const stripped = [];

        const cleaned = cmd.replace(HEAD_TAIL_PIPE, (m, tool) => {
            const num = m.match(/-n\s*(\d+)/)?.[1] ?? '?';
            stripped.push(`| ${tool} -n ${num}`);
            return '';
        });

        if (cleaned !== original) {
            event.input.command = cleaned;

            ctx.ui.notify(
                `block-head-tail: stripped ${stripped.length} pipe truncation(s) — ${stripped.join(', ')}\n` +
                    `  original: ${original}\n` +
                    `  modified: ${cleaned}`,
                'info',
            );
        }
    });

    registered.add(pi);
}
