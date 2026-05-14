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

export { CONFIG_PATH, loadModelsConfig, saveModelsConfig, watchConfig, unwatchConfig };
