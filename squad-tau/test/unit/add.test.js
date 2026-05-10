import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../../server/add.js';

describe('add', () => {
    it('adds two integers', () => {
        assert.equal(add(2, 3), 5);
        assert.equal(add(-1, 1), 0);
        assert.equal(add(0, 0), 0);
    });

    it('adds floating-point numbers', () => {
        assert.equal(add(1.5, 2.5), 4.0);
        assert.equal(add(0.1, 0.2), 0.30000000000000004);
    });

    it('returns NaN for non-numeric first argument', () => {
        assert.ok(Number.isNaN(add('5', 3)));
        assert.ok(Number.isNaN(add(null, 3)));
        assert.ok(Number.isNaN(add(undefined, 3)));
        assert.ok(Number.isNaN(add({}, 3)));
    });

    it('returns NaN for non-numeric second argument', () => {
        assert.ok(Number.isNaN(add(3, '5')));
        assert.ok(Number.isNaN(add(3, null)));
        assert.ok(Number.isNaN(add(3, undefined)));
        assert.ok(Number.isNaN(add(3, [])));
    });

    it('returns NaN for both non-numeric arguments', () => {
        assert.ok(Number.isNaN(add('a', 'b')));
    });

    it('is a pure function with no side effects', () => {
        const a = 5;
        const b = 10;
        const result1 = add(a, b);
        const result2 = add(a, b);
        assert.equal(result1, result2);
        assert.equal(a, 5);
        assert.equal(b, 10);
    });
});
