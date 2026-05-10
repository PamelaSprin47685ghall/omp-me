import fs from 'fs/promises';
import path from 'path';

async function captureFileSnapshots(files, cwd) {
    const snapshots = new Map();
    for (const file of files) {
        const absPath = path.resolve(cwd, file);
        try {
            const stat = await fs.stat(absPath);
            snapshots.set(absPath, stat.mtimeMs);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
    }
    return snapshots;
}

async function filesChanged(snapshots, cwd) {
    const changed = [];
    for (const [absPath, oldMtime] of snapshots.entries()) {
        try {
            const stat = await fs.stat(absPath);
            if (stat.mtimeMs !== oldMtime) {
                changed.push(absPath);
            }
        } catch (err) {
            if (err.code === 'ENOENT') {
                changed.push(absPath);
            } else {
                throw err;
            }
        }
    }
    return changed;
}

export { captureFileSnapshots, filesChanged };
