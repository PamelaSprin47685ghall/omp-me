// models-config.js — plan-exec model pool configuration + concurrency control

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_FILE_MODE = 0o600;

function getConfigDir() {
    return join(process.env.OMP_PLAN_EXEC_HOME || homedir(), '.omp', 'plan-exec');
}

function getConfigPath() {
    return join(getConfigDir(), 'models.json');
}

// ---------------------------------------------------------------------------
// Config I/O
// ---------------------------------------------------------------------------

export function loadModelsConfig() {
    const path = getConfigPath();
    if (!existsSync(path)) return [];
    try {
        const raw = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        return [];
    } catch {
        return [];
    }
}

export function saveModelsConfig(models) {
    const dir = getConfigDir();
    const path = getConfigPath();
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path, JSON.stringify(models, null, 2) + '\n', 'utf-8');
        try {
            chmodSync(path, CONFIG_FILE_MODE);
        } catch {
            /* best-effort permission set */
        }
    } catch {
        /* skip if read-only env */
    }
}

export { getConfigPath };

export function generateInitialConfig(modelRegistry) {
    const available = modelRegistry?.getAvailable?.() ?? [];
    return available.map((m) => ({
        provider: m.provider,
        id: m.id,
        thinkingLevel: undefined,
    }));
}

// ---------------------------------------------------------------------------
// Model pool — slots = config entries, duplicates = concurrency
// ---------------------------------------------------------------------------

class ModelPool {
    constructor(config) {
        this.slots = (config ?? []).map((entry) => ({
            provider: entry.provider,
            id: entry.id,
            thinkingLevel: entry.thinkingLevel ?? undefined,
            busy: false,
        }));
        this.waiters = [];
    }

    /**
     * Acquire a free slot. Randomly picks among available slots.
     * If none are free, queues until a slot is released or signal aborts.
     * Returns an object with { provider, id, thinkingLevel, release }.
     */
    async acquire(signal) {
        while (true) {
            const free = this.slots.filter((s) => !s.busy);
            if (free.length > 0) {
                const slot = free[Math.floor(Math.random() * free.length)];
                slot.busy = true;
                return {
                    provider: slot.provider,
                    id: slot.id,
                    thinkingLevel: slot.thinkingLevel,
                    release: () => {
                        slot.busy = false;
                        this._wakeNext();
                    },
                };
            }

            // No slot available — wait
            await new Promise((resolve, reject) => {
                const waiter = { resolve, reject };
                this.waiters.push(waiter);
                if (signal) {
                    const onAbort = () => {
                        const idx = this.waiters.indexOf(waiter);
                        if (idx >= 0) this.waiters.splice(idx, 1);
                        reject(new Error('Parent session aborted'));
                    };
                    if (signal.aborted) {
                        onAbort();
                        return;
                    }
                    signal.addEventListener('abort', onAbort, { once: true });
                }
            });
        }
    }

    _wakeNext() {
        if (this.waiters.length > 0) {
            const next = this.waiters.shift();
            next.resolve();
        }
    }

    /**
     * Cancel all pending waiters (e.g. on abort).
     */
    cancelAll(reason = 'Plan execution aborted') {
        while (this.waiters.length > 0) {
            const w = this.waiters.shift();
            w.reject(new Error(reason));
        }
    }

    get totalSlots() {
        return this.slots.length;
    }

    get busyCount() {
        return this.slots.filter((s) => s.busy).length;
    }
}

export function createModelPool(config) {
    if (!Array.isArray(config) || config.length === 0) return null;
    return new ModelPool(config);
}
