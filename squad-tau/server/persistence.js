/**
 * Append-Only File (AOF) persistence — EventLog rehydration via .ndjson.
 *
 * Zero-state bootstrapping: on startup, EventLog reads .omp/squad/squad.ndjson
 * and replays every fact through Projections. The state tree instantly
 * rehydrates to the exact quantum it was before the process exited.
 *
 * The system becomes crash-immune (Phoenix): no database, no checkpoint,
 * no complex recovery logic — just the immutable truth of the event log.
 *
 * Plan files (.toml) are stored under .omp/squad/plans/<task>/ to survive
 * process restarts — fully persistent from plan definition to execution trace.
 */
import fs from 'fs';
import path from 'path';

const SQUAD_DIR = path.join(process.cwd(), '.omp', 'squad');
const PERSIST_PATH = path.join(SQUAD_DIR, 'squad.ndjson');
const PLANS_DIR = path.join(SQUAD_DIR, 'plans');

/** Ensure the squad directory tree exists. */
function ensureDirs() {
    if (!fs.existsSync(PLANS_DIR)) {
        fs.mkdirSync(PLANS_DIR, { recursive: true });
    }
}

/**
 * Load all persisted entries from the .ndjson file.
 * Returns an empty array if the file doesn't exist or is empty.
 */
export function loadFromNDJSON() {
    try {
        if (!fs.existsSync(PERSIST_PATH)) return [];
        const content = fs.readFileSync(PERSIST_PATH, 'utf8').trim();
        if (!content) return [];
        return content
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    } catch {
        return [];
    }
}

/** Create an append-only writer for .omp/squad/squad.ndjson */
export function createNDJSONWriter() {
    ensureDirs();

    let fd;
    try {
        fd = fs.openSync(PERSIST_PATH, 'a');
    } catch {
        return { write: () => {}, close: () => {} };
    }

    function write(data) {
        const list = Array.isArray(data) ? data : [data];
        for (const entry of list) {
            const line = JSON.stringify(entry) + '\n';
            fs.writeSync(fd, line);
        }
    }

    function close() {
        try {
            fs.closeSync(fd);
        } catch {}
    }

    return { write, close };
}

/**
 * Get the path for a plan directory under .omp/squad/plans/<name>/.
 * Creates the directory if it doesn't exist.
 */
export function planDir(name) {
    ensureDirs();
    const dir = path.join(PLANS_DIR, name);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * Discard the .ndjson file entirely — fresh squad start.
 * The old execution's event history is permanently deleted.
 */
export function discardNDJSON() {
    try {
        if (fs.existsSync(PERSIST_PATH)) {
            fs.unlinkSync(PERSIST_PATH);
        }
    } catch {
        // discard failure is non-fatal
    }
}
