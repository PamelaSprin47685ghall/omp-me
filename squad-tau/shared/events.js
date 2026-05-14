export const Events = {
    SQUAD_INIT: 'squad:init',
    SQUAD_NODE_STATE: 'squad:node_state',
    SQUAD_COMPLETE: 'squad:complete',
    SQUAD_ABORT: 'squad:abort',
    SQUAD_OUTER_REVIEW_START: 'squad:outer_review_start',
    SQUAD_OUTER_REVIEW_DONE: 'squad:outer_review_done',
    SQUAD_OUTER_REVIEW_FAILED: 'squad:outer_review_failed',

    SESSION_START: 'session:start',
    SESSION_STATE: 'session:state',
    SESSION_END: 'session:end',
    SESSION_MESSAGE: 'session:message',
    SESSION_TOOL_CALL: 'session:tool_call',
    SESSION_TOOL_RESULT: 'session:tool_result',

    SESSION_MESSAGE_DELTA: 'session:message_delta',
    SESSION_THINKING_DELTA: 'session:thinking_delta',

    MODEL_POOL_SNAPSHOT: 'model_pool:snapshot',

    SESSION_CREATING: 'session:creating',
    SESSION_PROMPTING: 'session:prompting',
};

export function sessionIdFor(nodeId, phase, retryCount) {
    return `${nodeId}::${phase}::${retryCount}`;
}
