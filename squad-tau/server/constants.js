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

const DEFAULTS = Object.freeze({
    MAX_RETRIES: 5,
});

export { STATUS, DEFAULTS };
