/**
 * WeakMap to track WebSocket connection state without monkey-patching.
 */

const states = new WeakMap();

/**
 * @param {import('ws').WebSocket} ws
 * @returns {object}
 */
export function getConnectionState(ws) {
    let state = states.get(ws);
    if (!state) {
        state = { connId: null, missedPongs: 0 };
        states.set(ws, state);
    }
    return state;
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {object} newState
 */
export function setConnectionState(ws, newState) {
    const state = getConnectionState(ws);
    Object.assign(state, newState);
}
