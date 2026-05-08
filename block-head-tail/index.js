/**
 * block-head-tail — oh-my-pi extension that strips | head -nXXX and | tail -nXXX
 * from bash tool commands. LLMs frequently pipe to head/tail as a crude truncation,
 * causing the agent to miss important output.
 */

const HEAD_TAIL_PIPE = /\s*\|\s*(?:head|tail)\s+-n\s*\d+\s*/g;

const registered = new WeakSet();

export default async function blockHeadTailExtension(pi) {
    if (registered.has(pi)) return;

    pi.on('tool_call', (event, ctx) => {
        if (event.toolName !== 'bash') return;

        const cmd = event.input?.command;
        if (typeof cmd !== 'string') return;

        const cleaned = cmd.replace(HEAD_TAIL_PIPE, '');

        if (cleaned !== cmd) {
            event.input.command = cleaned;
            ctx.ui.notify(`Stripped | head/tail pipe from bash command`, 'warning');
        }
    });

    registered.add(pi);
}
