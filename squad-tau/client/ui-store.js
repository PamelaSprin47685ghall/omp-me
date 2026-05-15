/**
 * UI Store — pure viewport state.
 * Physically separated from domain EventStore.
 * Zero business logic, zero EventLog dependency.
 */
const listeners = new Set();
let state = {
    viewMode: 'dag',
    activeSessionId: null,
    drawerOpen: false,
    bannerDismissed: false,
};

export const uiStore = {
    getState: () => state,
    dispatch(type, payload) {
        const nextState = { ...state };
        switch (type) {
            case 'ui:select_session':
                nextState.activeSessionId = payload.sessionId;
                nextState.viewMode = 'session';
                break;
            case 'ui:set_view_mode':
                nextState.viewMode = payload.viewMode;
                break;
            case 'ui:toggle_drawer':
                nextState.drawerOpen = payload.open;
                break;
            case 'ui:dismiss_banner':
                nextState.bannerDismissed = true;
                break;
        }
        state = nextState;
        for (const fn of listeners) fn();
    },
    subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
    },
};
