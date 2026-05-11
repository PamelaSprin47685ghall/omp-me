function buildBaseSessionOptions(ctx, pi, modelSlot) {
    const options = {
        cwd: ctx?.cwd ?? process.cwd(),
        hasUI: false,
    };

    if (ctx?.agentsMdSearch) options.agentsMdSearch = ctx.agentsMdSearch;
    if (ctx?.workspaceTree) options.workspaceTree = ctx.workspaceTree;

    if (ctx?.modelRegistry) options.modelRegistry = ctx.modelRegistry;
    if (ctx?.model) options.model = ctx.model;

    if (modelSlot) {
        const available = ctx?.modelRegistry?.getAvailable?.() ?? [];
        const matched = available.find((m) => m.provider === modelSlot.provider && m.id === modelSlot.modelId);
        if (matched) {
            options.model = matched;
            if (modelSlot.thinkingLevel) options.thinkingLevel = modelSlot.thinkingLevel;
        }
    }

    if (ctx?.getThinkingLevel) {
        const level = ctx.getThinkingLevel();
        if (level && !options.thinkingLevel) options.thinkingLevel = level;
    }

    if (ctx?.getSystemPrompt) {
        options.systemPrompt = ctx.getSystemPrompt();
    }

    return options;
}

function buildWorkerSessionOptions(ctx, pi, modelSlot) {
    const options = buildBaseSessionOptions(ctx, pi, modelSlot);

    const activeTools = (ctx?.session?.getActiveToolNames?.() ?? pi?.getActiveTools?.())?.filter(
        (t) => t !== 'delegate',
    );
    if (activeTools?.length > 0) options.toolNames = activeTools;

    return options;
}

export { buildBaseSessionOptions, buildWorkerSessionOptions };
