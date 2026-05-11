import { getReturnResolver } from './session-registry.js';

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

const RETURN = {
    name: 'return',
    label: 'Return',
    desc: 'Return result from current phase. You MUST call this tool to finish.',
    props: {
        status: { type: 'string', enum: ['ok', 'error'], description: 'ok = success/approve, error = failure/reject' },
        reason: { type: 'string', description: 'Summary or feedback' },
        affected_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files modified or created',
        },
    },
    required: ['status', 'reason'],
};

function buildReturnTool(resolve) {
    return createLifecycleTool(RETURN, (p) =>
        resolve({ status: p.status, reason: p.reason, affected_files: p.affected_files || [] }),
    );
}

function buildGlobalReturnTool() {
    return {
        name: RETURN.name,
        label: RETURN.label,
        description: RETURN.desc,
        parameters: {
            type: 'object',
            properties: RETURN.props,
            ...(RETURN.required?.length > 0 ? { required: RETURN.required } : {}),
        },
        async execute(_id, params, _sig, _upd, ctx) {
            const sessionFile = ctx?.sessionManager?.getSessionFile?.();
            if (!sessionFile) {
                throw new Error('sessionFile is required but not found in context');
            }
            const resolver = getReturnResolver(sessionFile);
            if (!resolver) {
                throw new Error(`No return resolver found for session ${sessionFile}`);
            }
            resolver(params);
            ctx?.abort?.();
            return { content: [], display: false };
        },
    };
}

export { createLifecycleTool, RETURN, buildReturnTool, buildGlobalReturnTool };
