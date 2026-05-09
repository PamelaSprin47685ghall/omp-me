/** Model pool config — read/write ~/.omp/squad/models.json. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function getConfigPath() {
    return join(process.env.OMP_SQUAD_HOME || homedir(), '.omp', 'squad', 'models.json');
}

function getConfigDir() {
    return join(process.env.OMP_SQUAD_HOME || homedir(), '.omp', 'squad');
}

export function loadModelsConfig() {
    const path = getConfigPath();
    if (!existsSync(path)) return null;
    try {
        const raw = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        return null;
    } catch {
        return null;
    }
}

export function saveModelsConfig(models) {
    const dir = getConfigDir();
    const path = getConfigPath();
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path, JSON.stringify(models, null, 2) + '\n', 'utf-8');
    } catch {
        /* read-only env, skip */
    }
}

export { getConfigPath };

class ModelPool {
    constructor(config) {
        this.slots = (config ?? []).map((entry) => ({
            provider: entry.provider,
            id: entry.modelId || entry.id,
            role: entry.role || 'worker',
            thinkingLevel: entry.thinkingLevel ?? undefined,
            busy: false,
        }));

        this.waiters = [];
    }

    get totalSlots() {
        return this.slots.length;
    }

    get busyCount() {
        return this.slots.filter((s) => s.busy).length;
    }

    async acquire(role, signal) {
        while (true) {
            const free = this.slots.filter((s) => !s.busy && s.role === role);

            if (free.length > 0) {
                const slot = free[Math.floor(Math.random() * free.length)];
                slot.busy = true;
                return {
                    provider: slot.provider,
                    id: slot.id,
                    thinkingLevel: slot.thinkingLevel,
                    role: slot.role,
                    release: () => {
                        slot.busy = false;
                        this._wakeNext();
                    },
                };
            }

            await new Promise((resolve, reject) => {
                const waiter = { resolve, reject, role };
                this.waiters.push(waiter);

                if (signal?.aborted) {
                    this._remove(waiter);
                    reject(new Error('DAG execution aborted'));
                    return;
                }

                if (signal) {
                    signal.addEventListener(
                        'abort',
                        () => {
                            this._remove(waiter);
                            reject(new Error('DAG execution aborted'));
                        },
                        { once: true },
                    );
                }
            });
        }
    }

    cancelAll(reason) {
        while (this.waiters.length > 0) {
            this.waiters.shift().reject(new Error(reason));
        }
    }

    _remove(waiter) {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
    }

    _wakeNext() {
        const next = this.waiters.shift();
        next?.resolve();
    }
}

export function createModelPool(config) {
    if (!config || config.length === 0) return null;
    return new ModelPool(config);
}
