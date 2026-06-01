import { getCodingAgentModule } from './pi-resolve.js';

export function readAssistantText(sessionManager, { startIndex = 0, joiner = '\n\n' } = {}) {
    const entries = sessionManager?.getEntries?.() || [];
    const chunks = [];
    for (let index = startIndex; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry?.type !== 'message') continue;
        if (entry.message?.role !== 'assistant') continue;
        for (const part of entry.message?.content || []) {
            if (part?.type === 'text' && part.text) chunks.push(part.text);
        }
    }
    return chunks.length > 0 ? chunks.join(joiner) : null;
}

export async function runSubagent(pi, ctx, config) {
    const child = await createChildSession(pi, ctx, config);

    try {
        await child.session.prompt(config.prompt);
        if (config.waitForResult) return await config.waitForResult(child.session, child.dispose);
        await child.session.waitForIdle();
        return readAssistantText(child.session.sessionManager);
    } finally {
        if (!config.waitForResult) {
            child.session.abort?.();
            child.dispose?.();
        }
    }
}

export async function createChildSession(pi, ctx, config) {
    const createAgentSession = pi?.pi?.createAgentSession;
    if (!createAgentSession) throw new Error('createAgentSession unavailable');
    const { SessionManager } = await getCodingAgentModule();
    return await createAgentSession({
        cwd: ctx?.cwd ?? process.cwd(),
        hasUI: false,
        toolNames: config.toolNames,
        modelRegistry: ctx?.modelRegistry,
        model: ctx?.model,
        thinkingLevel: ctx?.getThinkingLevel?.(),
        systemPrompt: config.systemPrompt ?? ctx?.getSystemPrompt?.(),
        agentsMdSearch: ctx?.agentsMdSearch,
        workspaceTree: ctx?.workspaceTree,
        sessionManager: SessionManager.create(ctx?.cwd ?? process.cwd()),
        customTools: config.customTools || [],
    });
}
