import { STATUS } from './constants.js';

const registry = new Map();

function register(sessionId, entry) {
    if (!sessionId || !entry) {
        throw new Error('sessionId and entry are required');
    }
    if (typeof entry.sendUserMessage !== 'function') {
        throw new Error('entry.sendUserMessage must be a function');
    }
    registry.set(sessionId, entry);
}

function unregister(sessionId) {
    const entry = registry.get(sessionId);
    if (entry) {
        delete entry.returnResolver;
    }
    registry.delete(sessionId);
}

function get(sessionId) {
    return registry.get(sessionId);
}

function isActive(sessionId) {
    const entry = registry.get(sessionId);
    if (!entry) return false;
    const inactive = ['completed', 'aborted', 'error', 'failed'];
    return !inactive.includes(entry.status);
}

function setReturnResolver(sessionId, resolve) {
    const entry = registry.get(sessionId);
    if (!entry) throw new Error(`Session ${sessionId} not found`);
    entry.returnResolver = resolve;
}

function getReturnResolver(sessionId) {
    return registry.get(sessionId)?.returnResolver;
}

function clearReturnResolver(sessionId) {
    const entry = registry.get(sessionId);
    if (entry) {
        delete entry.returnResolver;
    }
}

export { register, unregister, get, isActive, setReturnResolver, getReturnResolver, clearReturnResolver };
