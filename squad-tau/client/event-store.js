import { streamingManager } from './streaming-manager.js';
import { project } from '@shared/projections.js';

/**
 * Client-side Event Store and Projections (CQRS).
 * Maintains an append-only log and derived Read Models.
 */
class EventStore {
    constructor() {
        this.log = [];
        this.cursor = 0;
        this.listeners = new Set();
        this.state = project([]);
    }

    dispatch(type, payload, seq) {
        if (type === 'session:message_delta' || type === 'session:thinking_delta') {
            streamingManager.emit(payload.messageId, payload.delta);
            this.applyDelta(payload);
            this.notify();
            return;
        }

        if (seq != null) {
            this.cursor = Math.max(this.cursor, seq + 1);
        }

        this.log.push({ type, payload, seq });
        this.state = project(this.log);
        this.notify();
    }

    applyDelta(payload) {
        const sess = this.state.sessions[payload.sessionId];
        if (!sess) return;

        const list = sess.messages;
        const msgIdx = list.findIndex((m) => m.messageId === payload.messageId);

        if (msgIdx === -1) {
            const blockType = payload.delta.type === 'thinking_delta' ? 'thinking' : 'text';
            list.push({
                role: 'assistant',
                messageId: payload.messageId,
                content: [{ type: blockType, text: '' }],
                streaming: true,
            });
        } else if (!list[msgIdx].streaming) {
            list[msgIdx] = { ...list[msgIdx], streaming: true };
        }
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify() {
        this.listeners.forEach((l) => l());
    }

    reset() {
        this.log = [];
        this.cursor = 0;
        this.state = project([]);
        this.notify();
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
