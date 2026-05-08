/**
 * Pure function state machine for squad node lifecycle.
 *
 *   pending → waiting_deps → authoring → confirming → reviewing → approved
 *                                                     ↓           ↓
 *                                                  blocked      failed
 */

export const STATUS = {
    PENDING: 'pending',
    WAITING_DEPS: 'waiting_deps',
    AUTHORING: 'authoring',
    CONFIRMING: 'confirming',
    REVIEWING: 'reviewing',
    APPROVED: 'approved',
    FAILED: 'failed',
    BLOCKED: 'blocked',
};

export const EVENT = {
    REGISTER: 'register',
    START: 'start',
    WORKER_SUBMIT: 'worker_submit',
    CONFIRM: 'confirm',
    SILENT_CONFIRM: 'silent_confirm',
    APPROVE: 'approve',
    REJECT: 'reject',
    SESSION_ERROR: 'session_error',
    ABORT: 'abort',
};

export const MAX_RETRIES = 3;

function initialStatus(hasDeps) {
    return hasDeps ? STATUS.WAITING_DEPS : STATUS.PENDING;
}

export function transition(state, event) {
    switch (event.type) {
        case EVENT.REGISTER:
            return { ...state, status: initialStatus(!!event.hasDeps) };

        case EVENT.START:
            return { ...state, status: STATUS.AUTHORING, retryCount: event.retryCount ?? 0 };

        case EVENT.WORKER_SUBMIT:
            return {
                ...state,
                status: STATUS.CONFIRMING,
                workerSummary: event.summary,
                workerFiles: event.files,
            };

        case EVENT.CONFIRM:
            return { ...state, status: STATUS.REVIEWING };

        case EVENT.SILENT_CONFIRM:
            return { ...state, confirmNudge: true };

        case EVENT.APPROVE:
            return { ...state, status: STATUS.APPROVED };

        case EVENT.REJECT: {
            const nextRetry = (state.retryCount ?? 0) + 1;
            if (nextRetry > (event.maxRetries ?? MAX_RETRIES)) {
                return {
                    ...state,
                    status: STATUS.BLOCKED,
                    retryCount: nextRetry,
                    lastFeedback: event.feedback,
                };
            }
            return {
                ...state,
                status: STATUS.AUTHORING,
                retryCount: nextRetry,
                lastFeedback: event.feedback,
            };
        }

        case EVENT.SESSION_ERROR: {
            const nextRetry = (state.retryCount ?? 0) + 1;
            if (nextRetry > (event.maxRetries ?? MAX_RETRIES)) {
                return { ...state, status: STATUS.FAILED, error: event.error };
            }
            return {
                ...state,
                status: STATUS.AUTHORING,
                retryCount: nextRetry,
                lastFeedback: `Session error: ${event.error}. Please retry.`,
            };
        }

        case EVENT.ABORT:
            return { ...state, status: STATUS.FAILED, error: 'Aborted' };

        default:
            return state;
    }
}

export function emptyState(nodeId) {
    return {
        nodeId,
        status: STATUS.PENDING,
        retryCount: 0,
        lastFeedback: null,
        workerSummary: null,
        workerFiles: [],
        confirmNudge: false,
        error: null,
    };
}
