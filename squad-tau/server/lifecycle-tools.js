function createLifecycleTool(spec, onInvoke) {
    return {
        name: spec.name,
        label: spec.label,
        description: spec.desc,
        parameters: {
            type: 'object',
            properties: spec.props,
            ...(spec.required?.length > 0 ? { required: spec.required } : {}),
        },
        async execute(_id, params, _sig, _upd, childCtx) {
            onInvoke(params);
            childCtx?.abort?.();
            return { content: [], display: false };
        },
    };
}

const RTN_WORK = {
    name: 'return_work',
    label: 'Return Work',
    desc: 'Submit completed work. You MUST call this tool to finish.',
    props: {
        summary: { type: 'string', description: 'What you accomplished' },
        affected_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files you modified or created',
        },
    },
    required: ['summary', 'affected_files'],
};

function buildReturnWorkTool(resolve) {
    return createLifecycleTool(RTN_WORK, (p) =>
        resolve({ summary: p.summary, affected_files: p.affected_files || [] }),
    );
}

export { createLifecycleTool, RTN_WORK, buildReturnWorkTool };
