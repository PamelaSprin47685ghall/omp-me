const STATUS = Object.freeze({
    WAITING_DEPS: 'waiting_deps',
    PENDING: 'pending',
    AUTHORING: 'authoring',
    CONFIRMING: 'confirming',
    REVIEWING: 'reviewing',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    BLOCKED: 'blocked',
    FAILED: 'failed',
});

const EVENT = Object.freeze({
    START: 'start',
    WORKER_SUBMIT: 'worker_submit',
    CONFIRM: 'confirm',
    REVIEW_APPROVED: 'review_approved',
    REVIEW_REJECTED: 'review_rejected',
    FAIL: 'fail',
    BLOCK: 'block',
});

const WS_EVENT_TYPES = Object.freeze({
    CONNECTION: Object.freeze(['connection:established', 'connection:close', 'ping', 'pong']),
    SQUAD: Object.freeze([
        'squad:init',
        'squad:node_state',
        'squad:complete',
        'squad:outer_review_start',
        'squad:outer_review_result',
        'squad:abort',
    ]),
    SESSION: Object.freeze([
        'session:start',
        'session:state',
        'session:message',
        'session:message_delta',
        'session:tool_call',
        'session:tool_result',
        'session:end',
        'session:user_message',
    ]),
    MODEL_POOL: Object.freeze(['model_pool:snapshot', 'model_pool:update', 'model_pool:changed']),
});

const DEFAULTS = Object.freeze({
    FALLBACK_CONCURRENCY: 5,
    MAX_EMPTY_TURNS: 20,
    CONFIRM_MAX_EMPTY: 5,
    HEARTBEAT_INTERVAL: 30000,
    HEARTBEAT_TIMEOUT: 60000,
    MAX_RETRIES: 3,
});

const SESSION_PHASES = Object.freeze(['worker', 'reviewer', 'outer_review', 'main']);

export { STATUS, EVENT, WS_EVENT_TYPES, DEFAULTS, SESSION_PHASES };
