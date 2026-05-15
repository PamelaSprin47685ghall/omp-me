import { applyEvent, project } from '../shared/projections.js';

/**
 * Client-side Event Store — pure business state with entity-level tracking.
 *
 * Tracks both path-level and entity-level versions for granular subscriptions.
 * - Path versions: coarse-grained (sessions, messages, toolCalls, squad, modelPool)
 * - Entity versions: fine-grained (messages:msg-1, toolCalls:tc-1, sessions:sid)
 *
 * ZERO awareness of streaming/delta events. Physically isolated.
 */

const ENTITY_EVENTS = {
    'entity:created': { path: 'messages', entityKey: 'entityId', entityType: (p) => `${p.entityType}s` },
    'entity:finalized': { path: 'messages', entityKey: 'entityId', entityType: (p) => `${p.entityType}s` },
    'session:message_start': { path: 'messages', entityKey: 'messageId', entityType: () => 'messages' },
    'session:message': { path: 'messages', entityKey: 'messageId', entityType: () => 'messages' },
    'session:tool_call': { path: 'toolCalls', entityKey: 'toolId', entityType: () => 'toolCalls' },
    'session:tool_result': { path: 'toolCalls', entityKey: 'toolId', entityType: () => 'toolCalls' },
};

const PATH_DOMAIN = {
    session: 'sessions',
    model_pool: 'modelPool',
    squad: 'squad',
    ui: 'ui',
};

class EventStore {
    constructor() {
        this.cursor = 0;
        this.listeners = new Set();
        this.state = project([]);
        this._pathVersions = {};
        this._changedPaths = new Set();
        this._entityVersions = {};
        this._changedEntities = new Set();
    }

    _trackPath(type) {
        const domain = type.split(':')[0];
        const path = PATH_DOMAIN[domain] || domain;
        this._changedPaths.add(path);
    }

    _trackEntity(type, payload) {
        if (!payload) return;
        const cfg = ENTITY_EVENTS[type];
        if (cfg) {
            const id = payload[cfg.entityKey];
            const typeName = cfg.entityType(payload);
            if (id) {
                const key = `${typeName}:${id}`;
                this._entityVersions[key] = (this._entityVersions[key] || 0) + 1;
                this._changedEntities.add(key);
                // [修复] 强制触发路径级更新，防止外层容器级联短路
                this._changedPaths.add(cfg.path);
            }
        }
        // Always track session entity if sessionId present
        if (payload.sessionId) {
            const key = `sessions:${payload.sessionId}`;
            this._entityVersions[key] = (this._entityVersions[key] || 0) + 1;
            this._changedEntities.add(key);
            // [修复] 强制触发 sessions 路径更新
            this._changedPaths.add('sessions');
        }
        // Cascade track parent message when tool_call references a messageId
        if (payload.messageId) {
            const key = `messages:${payload.messageId}`;
            this._entityVersions[key] = (this._entityVersions[key] || 0) + 1;
            this._changedEntities.add(key);
        }
    }

    dispatch(type, payload, seq) {
        this._changedPaths.clear();
        this._changedEntities.clear();
        if (seq != null) {
            this.cursor = Math.max(this.cursor, seq + 1);
        }
        applyEvent(this.state, type, payload);
        this._trackPath(type);
        this._trackEntity(type, payload);
        for (const p of this._changedPaths) {
            this._pathVersions[p] = (this._pathVersions[p] || 0) + 1;
        }
        this._notify();
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _notify() {
        const paths = this._changedPaths;
        const entities = this._changedEntities;
        this.listeners.forEach((l) => {
            if (l.length >= 2) l(paths, entities);
            else l(paths);
        });
    }

    reset() {
        this.cursor = 0;
        this.state = project([]);
        this._pathVersions = {};
        this._entityVersions = {};
        this._changedPaths.clear();
        this._changedEntities.clear();
        this.listeners.forEach((l) => l());
    }

    getCursor() {
        return this.cursor;
    }
    getState() {
        return this.state;
    }
    getPathVersion(path) {
        return this._pathVersions[path] || 0;
    }
    getEntityVersion(type, id) {
        return this._entityVersions[`${type}:${id}`] || 0;
    }
}

export { EventStore };
export const eventStore = new EventStore();

if (typeof window !== 'undefined') window.__es = eventStore;
