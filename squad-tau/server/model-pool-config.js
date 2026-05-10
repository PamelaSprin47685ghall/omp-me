import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_PATH = path.join(os.homedir(), '.omp/squad/models.json');

let watcherActive = false;
let debounceTimer = null;

function loadModelsConfig() {
    try {
        const content = fs.readFileSync(CONFIG_PATH, 'utf8');
        return JSON.parse(content);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        return [];
    }
}

function saveModelsConfig(config) {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function watchConfig(callback) {
    if (watcherActive) return;
    watcherActive = true;

    fs.watchFile(CONFIG_PATH, { interval: 300 }, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const config = loadModelsConfig();
            callback(config);
        }, 300);
    });
}

function unwatchConfig() {
    if (!watcherActive) return;
    watcherActive = false;
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    fs.unwatchFile(CONFIG_PATH);
}

/**
 * Sync a ModelPool instance to match a given configuration array.
 * Adds new slots, removes deleted slots. In-use removed slots
 * are marked pending_delete and removed on release.
 * @param {import('./model-pool.js').ModelPool} modelPool
 * @param {Array} newConfig - New configuration array
 */
function syncModelPoolFromConfig(modelPool, newConfig) {
    const oldSlots = modelPool.getSlots();
    const oldMap = new Map(oldSlots.map((s) => [`${s.provider}|${s.modelId}|${s.role}`, s]));
    const newKeys = new Set(newConfig.map((s) => `${s.provider}|${s.modelId}|${s.role}`));

    for (const entry of newConfig) {
        const key = `${entry.provider}|${entry.modelId}|${entry.role}`;
        if (!oldMap.has(key)) {
            modelPool.addSlot(entry);
        }
    }

    for (const [key, slot] of oldMap) {
        if (!newKeys.has(key)) {
            const allSlots = [...modelPool.workerSlots, ...modelPool.reviewerSlots];
            const idx = allSlots.indexOf(slot);
            if (idx !== -1) modelPool.removeSlot(idx);
        }
    }
}

export { CONFIG_PATH, loadModelsConfig, saveModelsConfig, watchConfig, unwatchConfig, syncModelPoolFromConfig };
