/**
 * NDJSON Mirror — EventLog's silent shadow.
 *
 * `createAofMirror` subscribes to the EventLog and serialises every fact
 * as a single NDJSON line into the target file. It never writes back.
 *
 * `loadFromNDJSON` reads a prior session's .ndjson for cold-start replay.
 *
 * Architecture invariant:
 *   The EventLog fires facts synchronously; the mirror writes asynchronously
 *   via a buffered stream. The EventLog is NEVER blocked on disk I/O.
 */
import fs from 'fs';

export function loadFromNDJSON(filePath) {
    try {
        if (!filePath) return [];
        const raw = fs.readFileSync(filePath, 'utf8').trim();
        if (!raw) return [];
        return raw
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    } catch {
        return [];
    }
}

export function createNDJSONWriter(filePath) {
    const fp = filePath || './squad-events.ndjson';
    const stream = fs.createWriteStream(fp, { flags: 'a', encoding: 'utf8' });
    let closed = false;
    return {
        write(data) {
            if (closed) return;
            const list = Array.isArray(data) ? data : [data];
            for (const entry of list) {
                stream.write(JSON.stringify(entry) + '\n');
            }
        },
        close() {
            if (closed) return;
            closed = true;
            return new Promise((resolve) => stream.end(resolve));
        },
    };
}

export function createAofMirror(eventLog, filePath) {
    const stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
    const unsub = eventLog.subscribe((data) => {
        const list = Array.isArray(data) ? data : [data];
        for (const entry of list) {
            stream.write(JSON.stringify(entry) + '\n');
        }
    });
    return {
        close() {
            unsub();
            stream.end();
        },
    };
}
