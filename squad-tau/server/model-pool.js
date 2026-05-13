class ModelPool {
    constructor(config) {
        this.workerSlots = [];
        this.reviewerSlots = [];
        this.workerQueue = [];
        this.reviewerQueue = [];

        for (const entry of config) {
            const slot = {
                slotId: crypto.randomUUID(),
                provider: entry.provider,
                modelId: entry.modelId,
                role: entry.role,
                thinkingLevel: entry.thinkingLevel,
                inUse: false,
                pendingDelete: false,
            };
            if (entry.role === 'worker') {
                this.workerSlots.push(slot);
            } else if (entry.role === 'reviewer') {
                this.reviewerSlots.push(slot);
            }
        }
    }

    async acquire(role, signal) {
        const slots = role === 'worker' ? this.workerSlots : this.reviewerSlots;
        const queue = role === 'worker' ? this.workerQueue : this.reviewerQueue;

        // Pool completely empty (no slots for this role) → fallback to current session model
        if (slots.length === 0) {
            return null;
        }

        // All slots for this role are pending_delete → no slot can ever free up
        if (slots.every((s) => s.pendingDelete)) {
            return null;
        }

        // If parent abort already fired, don't queue a waiter that can never resolve
        if (signal?.aborted) {
            throw new Error('Acquire aborted');
        }

        const availableSlot = slots.find((s) => !s.inUse && !s.pendingDelete);
        if (availableSlot) {
            availableSlot.inUse = true;
            return {
                provider: availableSlot.provider,
                modelId: availableSlot.modelId,
                role: availableSlot.role,
                _slot: availableSlot,
            };
        }

        return new Promise((resolve, reject) => {
            // Re-check after creating the promise — abort might have fired between
            // the outer signal?.aborted check and this Promise constructor.
            if (signal?.aborted) {
                reject(new Error('Acquire aborted'));
                return;
            }
            const waiter = { resolve, reject };
            queue.push(waiter);

            const onAbort = () => {
                const index = queue.indexOf(waiter);
                if (index !== -1) {
                    queue.splice(index, 1);
                }
                reject(new Error('Acquire aborted'));
            };

            if (signal) {
                signal.addEventListener('abort', onAbort, { once: true });
                waiter.cleanup = () => signal.removeEventListener('abort', onAbort);
            }
        });
    }

    release(slot) {
        if (!slot) return;
        const roleSlots = slot.role === 'worker' ? this.workerSlots : this.reviewerSlots;
        const queue = slot.role === 'worker' ? this.workerQueue : this.reviewerQueue;

        const targetSlot = slot._slot;
        if (!targetSlot || !roleSlots.includes(targetSlot)) return;

        targetSlot.pendingDelete
            ? this._purgeSlot(targetSlot, roleSlots, queue)
            : this._tryWakeWaiter(targetSlot, queue);
    }

    _purgeSlot(targetSlot, roleSlots, queue) {
        targetSlot.inUse = false;
        const index = roleSlots.indexOf(targetSlot);
        if (index !== -1) roleSlots.splice(index, 1);
        this._wakeFromAnyFree(queue, roleSlots);
    }

    _tryWakeWaiter(targetSlot, queue) {
        targetSlot.inUse = false;
        if (queue.length === 0) return;
        const waiter = queue.shift();
        if (!waiter) return;
        targetSlot.inUse = true;
        waiter.cleanup?.();
        waiter.resolve({
            provider: targetSlot.provider,
            modelId: targetSlot.modelId,
            role: targetSlot.role,
            _slot: targetSlot,
        });
    }

    _wakeFromAnyFree(queue, roleSlots) {
        if (queue.length === 0) return;
        const free = roleSlots.find((s) => !s.inUse && !s.pendingDelete);
        if (!free) return;
        const waiter = queue.shift();
        if (!waiter) return;
        free.inUse = true;
        waiter.cleanup?.();
        waiter.resolve({
            provider: free.provider,
            modelId: free.modelId,
            role: free.role,
            _slot: free,
        });
    }

    addSlot(config) {
        const slot = {
            slotId: config.slotId || crypto.randomUUID(),
            provider: config.provider,
            modelId: config.modelId,
            role: config.role,
            thinkingLevel: config.thinkingLevel,
            inUse: false,
            pendingDelete: false,
        };

        if (config.role === 'worker') {
            this.workerSlots.push(slot);
            this._tryWakeWaiter(slot, this.workerQueue);
        } else if (config.role === 'reviewer') {
            this.reviewerSlots.push(slot);
            this._tryWakeWaiter(slot, this.reviewerQueue);
        }
    }

    removeSlot(slotId) {
        const allSlots = [...this.workerSlots, ...this.reviewerSlots];
        const targetSlot = allSlots.find((s) => s.slotId === slotId);
        if (!targetSlot) return;

        const roleSlots = targetSlot.role === 'worker' ? this.workerSlots : this.reviewerSlots;
        const slotIndex = roleSlots.indexOf(targetSlot);

        if (targetSlot.inUse) {
            targetSlot.pendingDelete = true;
        } else {
            roleSlots.splice(slotIndex, 1);
        }
    }

    updateSlotThinkingLevel(slotId, thinkingLevel) {
        const allSlots = [...this.workerSlots, ...this.reviewerSlots];
        const targetSlot = allSlots.find((s) => s.slotId === slotId);
        if (!targetSlot) return;
        targetSlot.thinkingLevel = thinkingLevel;
    }

    getSlots() {
        return [...this.workerSlots, ...this.reviewerSlots];
    }

    getStats() {
        return {
            workerAvail: this.workerSlots.filter((s) => !s.inUse && !s.pendingDelete).length,
            workerTotal: this.workerSlots.length,
            reviewerAvail: this.reviewerSlots.filter((s) => !s.inUse && !s.pendingDelete).length,
            reviewerTotal: this.reviewerSlots.length,
        };
    }
}

export { ModelPool };
