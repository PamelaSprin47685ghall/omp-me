class ModelPool {
    constructor(config) {
        this.workerSlots = [];
        this.reviewerSlots = [];
        this.workerQueue = [];
        this.reviewerQueue = [];

        for (const entry of config) {
            const slot = {
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

        const availableSlot = slots.find((s) => !s.inUse && !s.pendingDelete);
        if (availableSlot) {
            availableSlot.inUse = true;
            return { provider: availableSlot.provider, modelId: availableSlot.modelId, role: availableSlot.role };
        }

        return new Promise((resolve, reject) => {
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
        const roleSlots = slot.role === 'worker' ? this.workerSlots : this.reviewerSlots;
        const queue = slot.role === 'worker' ? this.workerQueue : this.reviewerQueue;

        const targetSlot = roleSlots.find((s) => s.provider === slot.provider && s.modelId === slot.modelId && s.inUse);
        if (!targetSlot) return;

        targetSlot.inUse = false;

        if (targetSlot.pendingDelete) {
            const index = roleSlots.indexOf(targetSlot);
            if (index !== -1) {
                roleSlots.splice(index, 1);
            }
            return;
        }

        if (queue.length > 0) {
            targetSlot.inUse = true;
            const waiter = queue.shift();
            waiter.cleanup?.();
            waiter.resolve({ provider: targetSlot.provider, modelId: targetSlot.modelId, role: targetSlot.role });
        }
    }

    addSlot(config) {
        const slot = {
            provider: config.provider,
            modelId: config.modelId,
            role: config.role,
            thinkingLevel: config.thinkingLevel,
            inUse: false,
            pendingDelete: false,
        };

        if (config.role === 'worker') {
            this.workerSlots.push(slot);
            if (this.workerQueue.length > 0) {
                slot.inUse = true;
                const waiter = this.workerQueue.shift();
                waiter.cleanup?.();
                waiter.resolve({ provider: slot.provider, modelId: slot.modelId, role: slot.role });
            }
        } else if (config.role === 'reviewer') {
            this.reviewerSlots.push(slot);
            if (this.reviewerQueue.length > 0) {
                slot.inUse = true;
                const waiter = this.reviewerQueue.shift();
                waiter.cleanup?.();
                waiter.resolve({ provider: slot.provider, modelId: slot.modelId, role: slot.role });
            }
        }
    }

    removeSlot(index) {
        const allSlots = [...this.workerSlots, ...this.reviewerSlots];
        if (index < 0 || index >= allSlots.length) return;

        const targetSlot = allSlots[index];
        const roleSlots = targetSlot.role === 'worker' ? this.workerSlots : this.reviewerSlots;
        const slotIndex = roleSlots.indexOf(targetSlot);

        if (targetSlot.inUse) {
            targetSlot.pendingDelete = true;
        } else {
            roleSlots.splice(slotIndex, 1);
        }
    }

    updateSlotThinkingLevel(index, thinkingLevel) {
        const allSlots = [...this.workerSlots, ...this.reviewerSlots];
        if (index < 0 || index >= allSlots.length) return;
        allSlots[index].thinkingLevel = thinkingLevel;
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
