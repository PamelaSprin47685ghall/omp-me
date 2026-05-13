import { EventEmitter } from 'events';

class EventBus {
    constructor() {
        this.emitter = new EventEmitter();
        this.wildcardHandlers = new Map();
    }

    emit(namespace, event, payload) {
        const fullEvent = `${namespace}:${event}`;
        try {
            this.emitter.emit(fullEvent, payload);
        } catch (err) {
            console.error(`[EventBus] Error in handler for ${fullEvent}:`, err);
        }

        for (const [pattern, handlers] of this.wildcardHandlers) {
            const prefix = pattern.replace('*', '');
            if (pattern === '*' || (prefix && fullEvent.startsWith(prefix))) {
                for (const handler of handlers) {
                    try {
                        handler(payload, fullEvent);
                    } catch (err) {
                        console.error(`[EventBus] Error in wildcard handler for ${pattern}:`, err);
                    }
                }
            }
        }
    }

    /**
     * Subscribe to an exact event.
     * Prefix patterns like `namespace:*` match all events under a namespace.
     * Use `onPrefix` for prefix-only semantics (no wildcard confusion).
     * Pattern `*` matches all events.
     */
    on(pattern, handler) {
        if (pattern.includes('*')) {
            if (!this.wildcardHandlers.has(pattern)) {
                this.wildcardHandlers.set(pattern, new Set());
            }
            this.wildcardHandlers.get(pattern).add(handler);

            return () => this.off(pattern, handler);
        }

        this.emitter.on(pattern, handler);
        return () => this.off(pattern, handler);
    }

    /**
     * Subscribe to all events under a namespace prefix.
     * Like `on('namespace:*')` but with explicit prefix-only semantics.
     * @param {string} prefix - Namespace prefix (e.g. 'session')
     * @param {function} handler - Handler receiving (payload, fullEvent)
     * @returns {function} unsubscribe
     */
    onPrefix(prefix, handler) {
        const pattern = `${prefix}:*`;
        return this.on(pattern, handler);
    }

    off(pattern, handler) {
        if (pattern.includes('*')) {
            const handlers = this.wildcardHandlers.get(pattern);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    this.wildcardHandlers.delete(pattern);
                }
            }
            return;
        }

        this.emitter.off(pattern, handler);
    }
}

export { EventBus };
