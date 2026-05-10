import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register, unregister, get, isActive } from '../../server/session-registry.js';
import { STATUS } from '../../server/constants.js';

describe('session-registry', () => {
    const entry = (status) => ({ status, sendUserMessage: () => {} });

    it('register/get/unregister cycle', () => {
        const e = entry(STATUS.PENDING);
        register('t1', e);
        assert.strictEqual(get('t1'), e);
        unregister('t1');
        assert.strictEqual(get('t1'), undefined);
    });

    it('unregister unknown id does not throw', () => {
        assert.doesNotThrow(() => unregister('unknown-id'));
    });

    it('isActive returns true for active statuses', () => {
        [STATUS.WAITING_DEPS, STATUS.PENDING, STATUS.AUTHORING, STATUS.CONFIRMING, STATUS.REVIEWING].forEach((s, i) => {
            register(`a${i}`, entry(s));
            assert.strictEqual(isActive(`a${i}`), true);
            unregister(`a${i}`);
        });
    });

    it('isActive returns false for inactive statuses', () => {
        [STATUS.APPROVED, STATUS.REJECTED, STATUS.BLOCKED, STATUS.FAILED].forEach((s, i) => {
            register(`b${i}`, entry(s));
            assert.strictEqual(isActive(`b${i}`), false);
            unregister(`b${i}`);
        });
    });

    it('isActive returns false for unknown id', () => {
        assert.strictEqual(isActive('nonexistent'), false);
    });
});
