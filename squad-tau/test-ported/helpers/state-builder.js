/**
 * Event Sequence Builder — declarative DSL for constructing test state.
 *
 * Pure functional: accumulates an event log, then folds via project().
 * This validates the fact path: if the event sequence can't produce
 * the desired state, fold() throws with a clear [Projection] error.
 *
 * Usage:
 *   const state = buildState()
 *     .withSquad({ mode: 'M', nodes: [{ id: 'n1', depends_on: [] }] })
 *     .withSession('urn:s:s1:v1', 'n1', 'authoring')
 *     .withEndedSession('urn:s:s1:v1', 'completed')
 *     .fold();
 */
import { project, applyEvent, getInitialState } from '../../shared/projections.js';

export class StateBuilder {
    constructor() {
        this._log = [];
        this._overrides = {};
    }

    /** Seed a squad with mode and node definitions */
    withSquad({ mode = 'M', nodes = [], originalTask = 'test' } = {}) {
        this._log.push({
            event: 'squad:init',
            payload: { mode, nodes: nodes.map((n) => ({ ...n, depends_on: n.depends_on || [] })), originalTask },
        });
        for (const n of nodes) {
            if (n.status && n.status !== 'authoring') {
                this._log.push({
                    event: 'squad:node_state',
                    payload: { nodeId: n.id, status: n.status, epoch: n.epoch ?? 0 },
                });
            }
        }
        return this;
    }

    /** Create a pending→active session */
    withSession(sessionId, nodeId, phase = 'authoring', epoch = 0, model = 'test') {
        this._log.push({ event: 'session:pending_creation', payload: { sessionId, nodeId, phase, epoch } });
        this._log.push({ event: 'session:start', payload: { sessionId, nodeId, epoch, phase, model } });
        return this;
    }

    /** End an active session */
    withEndedSession(sessionId, reason = 'completed', errorMessage) {
        const payload = { sessionId, reason };
        if (errorMessage) payload.errorMessage = errorMessage;
        this._log.push({ event: 'session:end', payload });
        return this;
    }

    /** Set squad-level overrides (applied after fold) */
    withSquadOverride(overrides) {
        this._overrides = { ...this._overrides, ...overrides };
        return this;
    }

    /** Fold the event log into final state */
    fold() {
        let state = project(this._log);
        if (Object.keys(this._overrides).length > 0) {
            state = { ...state, squad: { ...state.squad, ...this._overrides } };
        }
        return state;
    }
}

export function buildState() {
    return new StateBuilder();
}
