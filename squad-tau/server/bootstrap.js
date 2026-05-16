/**
 * Phoenix Bootstrap — zero-point cold start.
 *
 * New axiom: the system has NO "recovery" logic, only "replay" logic.
 * Cold start = load NDJSON truth source → create EventLog → fold state.
 * Before the final entry is folded, the Engine stays silent — zero facts produced.
 * After bootstrap completes, the brain (Reactor) takes over synchronously.
 *
 * No saveSnapshot(), no periodic checkpoint. State is computed exclusively
 * by replaying the EventLog through pure Projections.
 */
import { EventLog } from './event-log.js';
import { project } from '../shared/projections.js';
import fs from 'fs';

/**
 * Bootstrap from an array of pre-serialized log entries.
 * Pure — no I/O, no side effects.
 *
 * @param {Array<{event: string, payload: any, id?: number, tick?: number}>} entries
 * @returns {{ eventLog: EventLog, state: object }}
 */
export function bootstrap(entries) {
    const eventLog = new EventLog(entries);
    const state = project(eventLog.getLog());
    return { eventLog, state };
}

/**
 * Bootstrap from an NDJSON file path.
 * I/O gate — loads the file, then delegates to pure bootstrap().
 *
 * @param {string} filePath
 * @returns {{ eventLog: EventLog, state: object }}
 */
export function bootstrapFromFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8').trim();
        const entries = raw
            ? raw
                  .split('\n')
                  .filter(Boolean)
                  .map((line) => JSON.parse(line))
            : [];
        return bootstrap(entries);
    } catch {
        return bootstrap([]);
    }
}
