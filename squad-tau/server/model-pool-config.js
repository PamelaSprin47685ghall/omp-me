import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), '.omp', 'models.toml');

let watcherActive = false;
let debounceTimer = null;

function loadModelsConfig() {
    try {
        const content = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed =
            typeof Bun !== 'undefined' && Bun.TOML
                ? Bun.TOML.parse(content)
                : (() => {
                      throw new Error('TOML parsing requires Bun runtime');
                  })();
        const slots = parsed.slot || [];
        return slots.map((s) => ({
            provider: s.provider,
            modelId: s.model_id,
            role: s.role,
            thinkingLevel: s.thinking_level || undefined,
        }));
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        console.warn(`[squad] Failed to parse model config ${CONFIG_PATH}:`, err.message);
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
            modelPool.removeSlot(s.slotId);
            oldCounts.set(key, currentCount - 1);
        }
    }

    // Sync thinkingLevel of remaining slots to match the config file.
    // Without persistent slot IDs in TOML, we match by position: for each
    // newConfig entry, find the Nth pool slot with the same key and update.
    const poolSlots = modelPool.getSlots();
    const keyCounters = new Map();
    for (const entry of newConfig) {
        const key = `${entry.provider}|${entry.modelId}|${entry.role}`;
        const idx = keyCounters.get(key) || 0;
        keyCounters.set(key, idx + 1);
        // Find the (idx)th slot in pool with matching key
        let matchIdx = 0;
        for (const poolSlot of poolSlots) {
            const poolKey = `${poolSlot.provider}|${poolSlot.modelId}|${poolSlot.role}`;
            if (poolKey === key) {
                if (matchIdx === idx) {
                    if (poolSlot.thinkingLevel !== entry.thinkingLevel) {
                        modelPool.updateSlotThinkingLevel(poolSlot.slotId, entry.thinkingLevel);
                    }
                    break;
                }
                matchIdx++;
            }
        }
    }
}

export { CONFIG_PATH, loadModelsConfig, saveModelsConfig, watchConfig, unwatchConfig, syncModelPoolFromConfig };
