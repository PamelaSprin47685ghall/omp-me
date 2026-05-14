import { applyEvent, project } from '../shared/projections.js';

/**
 * Event-type to top-level state-path mapping for atomic subscriptions (Cut 5).
 * Each entry declares which state branches an event type modifies.
 */
const EventPaths = {
    'squad:init': 'squad',
    'squad:node_state': 'squad',
    'squad:complete': 'squad',
    'squad:abort': 'squad',
    'squad:outer_review_start': 'squad',
    'squad:outer_review_done': 'squad',
    'squad:outer_review_failed': 'squad',
    'session:creating': 'sessions',
    'session:start': 'sessions',
    'session:state': 'sessions',
    'session:end': 'sessions',
    'session:message': 'sessions',
    'session:tool_call': 'sessions',
    'session:tool_result': 'sessions',
    'session:message_delta': 'sessions',
    'session:thinking_delta': 'sessions',
    'session:user_message_received': 'sessions',
    'model_pool:snapshot': 'modelPool',
    'ui:select_session': 'ui',
    'ui:set_view_mode': 'ui',
    'ui:toggle_drawer': 'ui',
    'ui:dismiss_banner': 'ui',
};

/**
 * Client-side Event Store with path-tracked notifications.
 * Subscribers receive a Set of changed top-level state paths.
 */
class EventStore {
    constructor() {
        this.log = [];
        this.cursor = 0;
        this.listeners = new Set();
        this.state = project([]);
        this._changedPaths = new Set();
    }

    _trackPath(type) {
        const path = EventPaths[type];
        if (path) this._changedPaths.add(path);
    }

    dispatch(type, payload, seq) {
        this._changedPaths.clear();

        if (type.startsWith('ui:')) {
            applyEvent(this.state, type, payload);
            this._trackPath(type);
            this._notify();
            return;
        }

        if (type === 'session:message_delta' || type === 'session:thinking_delta') {
            this._applyDelta(payload);
            this._changedPaths.add('sessions');
            this._notify();
            return;
        }

        if (seq != null) {
            this.cursor = Math.max(this.cursor, seq + 1);
        }

        this.log.push({ type, payload, seq });
        applyEvent(this.state, type, payload);
        this._trackPath(type);
        this._notify();
    }

    _applyDelta(payload) {
        const sess = this.state.sessions[payload.sessionId];
        if (!sess) return;

        const list = sess.messages;
        const msgIdx = list.findIndex((m) => m.messageId === payload.messageId);

        if (msgIdx === -1) {
            const blockType = payload.delta.type === 'thinking_delta' ? 'thinking' : 'text';
            list.push({
                role: 'assistant',
                messageId: payload.messageId,
                content: [{ type: blockType, text: payload.delta.text || '' }],
                streaming: true,
            });
        } else {
            const msg = list[msgIdx];
            if (!msg.streaming) msg.streaming = true;
            if (payload.delta.type === 'thinking_delta') {
                const hasThinking = msg.content.some((c) => c.type === 'thinking');
                if (!hasThinking) msg.content.push({ type: 'thinking', text: '' });
            }
        }
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _notify() {
        const paths = this._changedPaths;
        this.listeners.forEach((l) => {
            if (l.length === 0) l();
            else l(paths);
        });
    }

    reset() {
        this.log = [];
        this.cursor = 0;
        this.state = project([]);
        this._changedPaths.clear();
        // Force-update all subscribers — no path filter on reset
        this.listeners.forEach((l) => l());
    }

    getCursor() {
        return this.cursor;
    }
    getState() {
        return this.state;
    }
}

export { EventStore };
export const eventStore = new EventStore();

if (typeof window !== 'undefined') window.__es = eventStore;
