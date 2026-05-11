import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), '.omp', 'models.toml');

let watcherActive = false;
let debounceTimer = null;

function loadModelsConfig() {
    try {
        const content = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = Bun.TOML.parse(content);
        const slots = parsed.slot || [];
        return slots.map((s) => ({
            provider: s.provider,
            modelId: s.model_id,
            role: s.role,
            thinkingLevel: s.thinking_level || undefined,
        }));
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
    let toml = '';
    for (const entry of config) {
        toml += '[[slot]]\n';
        toml += `provider = ${JSON.stringify(entry.provider)}\n`;
        toml += `model_id = ${JSON.stringify(entry.modelId)}\n`;
        toml += `role = ${JSON.stringify(entry.role)}\n`;
        if (entry.thinkingLevel) {
            toml += `thinking_level = ${JSON.stringify(entry.thinkingLevel)}\n`;
        }
        toml += '\n';
    }
    fs.writeFileSync(CONFIG_PATH, toml, 'utf8');
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

function syncModelPoolFromConfig(modelPool, newConfig) {
    const oldSlots = modelPool.getSlots();
    // Use a frequency map for old slots
    const oldCounts = new Map();
    for (const s of oldSlots) {
        const key = `${s.provider}|${s.modelId}|${s.role}`;
        oldCounts.set(key, (oldCounts.get(key) || 0) + 1);
    }

    // Use a frequency map for new slots
    const newCounts = new Map();
    for (const s of newConfig) {
        const key = `${s.provider}|${s.modelId}|${s.role}`;
        newCounts.set(key, (newCounts.get(key) || 0) + 1);
    }

    // Add missing slots
    for (const entry of newConfig) {
        const key = `${entry.provider}|${entry.modelId}|${entry.role}`;
        const oldCount = oldCounts.get(key) || 0;
        const newCount = newCounts.get(key);
        if (oldCount < newCount) {
            modelPool.addSlot(entry);
            oldCounts.set(key, oldCount + 1);
        }
    }

    // Remove extra slots
    const currentSlots = modelPool.getSlots();
    for (let i = currentSlots.length - 1; i >= 0; i--) {
        const s = currentSlots[i];
        const key = `${s.provider}|${s.modelId}|${s.role}`;
        const targetCount = newCounts.get(key) || 0;
        const currentCount = oldCounts.get(key) || 0;
        if (currentCount > targetCount) {
            modelPool.removeSlot(i);
            oldCounts.set(key, currentCount - 1);
        }
    }
}

export { CONFIG_PATH, loadModelsConfig, saveModelsConfig, watchConfig, unwatchConfig, syncModelPoolFromConfig };
