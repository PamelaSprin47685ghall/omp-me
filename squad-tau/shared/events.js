/**
 * Core event types for Squad-Tau.
 */
export const Events = {
    // Squad lifecycle
    SQUAD_INIT: 'squad:init',
    SQUAD_NODE_STATE: 'squad:node_state',
    SQUAD_COMPLETE: 'squad:complete',
    SQUAD_ABORT: 'squad:abort',
    SQUAD_OUTER_REVIEW_START: 'squad:outer_review_start',
    SQUAD_OUTER_REVIEW_DONE: 'squad:outer_review_done',
    SQUAD_OUTER_REVIEW_FAILED: 'squad:outer_review_failed',

    // Session lifecycle
    SESSION_START: 'session:start',
    SESSION_STATE: 'session:state',
    SESSION_END: 'session:end',
    SESSION_MESSAGE: 'session:message',
    SESSION_TOOL_CALL: 'session:tool_call',
    SESSION_TOOL_RESULT: 'session:tool_result',

    // Transient streaming (not in log by default, but defined here)
    SESSION_MESSAGE_DELTA: 'session:message_delta',
    SESSION_THINKING_DELTA: 'session:thinking_delta',

    // Resource management
    MODEL_POOL_SNAPSHOT: 'model_pool:snapshot',
    MODEL_POOL_ACQUIRE: 'model_pool:acquire',
    MODEL_POOL_RELEASE: 'model_pool:release',
    MODEL_POOL_CONFIG_UPDATE: 'model_pool:config_update',

    // Transitional facts (emitted by Engine when action execution begins)
    SESSION_CREATING: 'session:creating',
    SESSION_PROMPTING: 'session:prompting',

    // Declarative resource facts (emitted by Reactor or SideEffect)
    NODE_WAITING_FOR_MODEL: 'node:waiting_for_model',
    MODEL_ASSIGNED: 'model_pool:assigned',
};
