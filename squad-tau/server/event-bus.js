import { EventEmitter } from 'events';

class EventBus {
    constructor() {
        this.emitter = new EventEmitter();
        this.wildcardHandlers = new Map();
    }

    emit(namespace, event, payload) {
        const fullEvent = `${namespace}:${event}`;
        this.emitter.emit(fullEvent, payload);

        for (const [pattern, handlers] of this.wildcardHandlers) {
            if (pattern === '*' || fullEvent.startsWith(pattern.replace('*', ''))) {
                handlers.forEach((handler) => handler(payload, fullEvent));
            }
        }
    }

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
