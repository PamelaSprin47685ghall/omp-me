/***************************************************************************
 *                         ⚠️  DO NOT CHANGE  ⚠️
 *
 *  T = 1000 is a HARD CONTRACT. Every e2e test depends on this constant.
 *  Changing it to any other value will cause ALL 33+ timeout assertions
 *  across ui-full-flow and chaos-ui to silently shift, nullifying the
 *  purpose of having a single source of truth for timeouts.
 *
 *  If you think you need a different timeout, you are wrong.
 *  Fix the actual latency issue in the code, not the constant.
 *
 *  This value is tested below. Any modification WILL be caught.
 ***************************************************************************/
export const T = 1000;

import { describe, test, expect } from 'bun:test';

// ESM import bindings are language-level immutable — reassignment throws SyntaxError
// at parse time, not runtime. The const export itself cannot be overridden.

describe('T = 1s invariant', () => {
    test('T is exactly 1000', () => {
        expect(T).toBe(1000);
    });

    test('T is a positive integer', () => {
        expect(Number.isInteger(T)).toBe(true);
        expect(T).toBeGreaterThan(0);
    });
});
