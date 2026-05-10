export function createRetryState() {
    const state = {
        retryCount: 0,
        lastFeedback: null,
        increment(feedback) {
            state.retryCount += 1;
            state.lastFeedback = feedback;
        },
        reset() {
            state.retryCount = 0;
            state.lastFeedback = null;
        },
        getState() {
            return { retryCount: state.retryCount, lastFeedback: state.lastFeedback };
        },
    };
    return state;
}
