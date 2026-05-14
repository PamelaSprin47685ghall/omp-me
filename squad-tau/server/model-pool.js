/**
 * Model pool config — pure config loader, no slot management.
 * Reads models.toml for initial maxWorkers. No runtime state, no file I/O after init.
 * No acquire/release lifecycle. maxWorkers derived from slot count.
 */
import fs from 'fs';
import path from 'path';
import { Events } from '../shared/events.js';

const CONFIG_PATH = path.join(process.cwd(), '.omp', 'models.toml');

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
        return { maxWorkers: slots.length || 3, slots };
    } catch (err) {
        if (err.code === 'ENOENT') return { maxWorkers: 3, slots: [] };
        console.warn(`[squad] Failed to parse model config ${CONFIG_PATH}:`, err.message);
        return { maxWorkers: 3, slots: [] };
    }
}

export { CONFIG_PATH, loadModelsConfig };
