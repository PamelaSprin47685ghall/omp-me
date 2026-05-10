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
    registry.delete(sessionId);
}

function get(sessionId) {
    return registry.get(sessionId);
}

function isActive(sessionId) {
    const entry = registry.get(sessionId);
    if (!entry) return false;
    const inactive = [STATUS.APPROVED, STATUS.REJECTED, STATUS.BLOCKED, STATUS.FAILED];
    return !inactive.includes(entry.status);
}

export { register, unregister, get, isActive };
