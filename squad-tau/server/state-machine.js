import { STATUS, EVENT } from './constants.js';

const MAX_RETRIES = Infinity;

const TRANSITIONS = Object.freeze({
    [STATUS.WAITING_DEPS]: {
        [EVENT.START]: STATUS.PENDING,
        [EVENT.FAIL]: STATUS.FAILED,
        [EVENT.BLOCK]: STATUS.BLOCKED,
    },
    [STATUS.PENDING]: {
        [EVENT.START]: STATUS.AUTHORING,
        [EVENT.FAIL]: STATUS.FAILED,
        [EVENT.BLOCK]: STATUS.BLOCKED,
    },
    [STATUS.AUTHORING]: {
        [EVENT.WORKER_SUBMIT]: STATUS.CONFIRMING,
        [EVENT.FAIL]: STATUS.FAILED,
        [EVENT.BLOCK]: STATUS.BLOCKED,
    },
    [STATUS.CONFIRMING]: {
        [EVENT.CONFIRM]: STATUS.REVIEWING,
        [EVENT.FAIL]: STATUS.FAILED,
        [EVENT.BLOCK]: STATUS.BLOCKED,
    },
    [STATUS.REVIEWING]: {
        [EVENT.REVIEW_APPROVED]: STATUS.APPROVED,
        [EVENT.REVIEW_REJECTED]: STATUS.REJECTED,
        [EVENT.FAIL]: STATUS.FAILED,
        [EVENT.BLOCK]: STATUS.BLOCKED,
    },
    [STATUS.REJECTED]: {
        [EVENT.START]: STATUS.AUTHORING,
        [EVENT.FAIL]: STATUS.FAILED,
        [EVENT.BLOCK]: STATUS.BLOCKED,
    },
    [STATUS.APPROVED]: {},
    [STATUS.BLOCKED]: {},
    [STATUS.FAILED]: {},
});

function transition(state, event) {
    const { status, retryCount } = state;
    const validTransitions = TRANSITIONS[status];
    if (!validTransitions || !validTransitions[event]) {
        return state;
    }
    const nextStatus = validTransitions[event];
    const nextRetryCount = event === EVENT.REVIEW_REJECTED ? retryCount + 1 : retryCount;
    return { status: nextStatus, retryCount: nextRetryCount };
}

function emptyState(nodeId, hasDeps = false) {
    return {
        status: hasDeps ? STATUS.WAITING_DEPS : STATUS.PENDING,
        retryCount: 0,
    };
}

export { transition, emptyState, MAX_RETRIES };
