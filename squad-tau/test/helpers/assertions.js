import { expect } from 'bun:test';
import { SESSION_PHASES } from '../../server/constants.js';

export function assertNodeState(status, expected) {
    expect(status).toBe(expected);
}

export function assertEventFired(events, type) {
    const found = events.some((e) => e.type === type);
    expect(found).toBe(true);
}

export function assertSessionPhase(session, phase) {
    expect(SESSION_PHASES).toContain(phase);
    expect(session.phase).toBe(phase);
}

export async function waitForEvent(eventBus, type, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timeout waiting for event "${type}" (${timeout}ms)`)),
            timeout,
        );

        const off = eventBus.on(type, (payload) => {
            clearTimeout(timer);
            off();
            resolve(payload);
        });
    });
}

export async function waitForNamespacedEvent(eventBus, namespace, event, timeout = 5000) {
    return waitForEvent(eventBus, `${namespace}:${event}`, timeout);
}
