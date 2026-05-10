export const MAX_EMPTY_TURNS = 20;
export const CONFIRM_MAX_EMPTY = 5;
export const REVIEWER_MAX_EMPTY = 20;
export const OUTER_REVIEW_MAX_EMPTY = 20;

export function createCounter(maxTurns) {
    let count = 0;
    return {
        increment() {
            count += 1;
        },
        exceeded() {
            return count >= maxTurns;
        },
        reset() {
            count = 0;
        },
    };
}
