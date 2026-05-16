import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { toURN, fromURN, sessionURN, fromSessionURN } from '../../shared/identity.js';

describe('URN Identity Protocol', () => {
    it('toURN produces deterministic format', () => {
        assert.equal(toURN('n1', 1), 'urn:squad:node:n1:v1');
        assert.equal(toURN('node-a', 0), 'urn:squad:node:node-a:v0');
        assert.equal(toURN('__or__', 5), 'urn:squad:node:__or__:v5');
    });

    it('fromURN round-trips toURN', () => {
        const cases = [
            ['n1', 1],
            ['node-a', 0],
            ['__or__', 5],
            ['a', 999],
        ];
        for (const [nodeId, epoch] of cases) {
            assert.deepEqual(fromURN(toURN(nodeId, epoch)), { nodeId, epoch });
        }
    });

    it('fromURN throws on malformed URN', () => {
        assert.throws(() => fromURN(''), /Invalid URN/);
        assert.throws(() => fromURN('urn:squad:node:n1'), /Invalid URN/);
        assert.throws(() => fromURN('n1::v1'), /Invalid URN/);
        assert.throws(() => fromURN('urn:squad:node:n1:v1:extra'), /Invalid URN/);
    });

    it('URN never contains state words: authoring, reviewing, confirming', () => {
        const urn = toURN('n1', 0);
        assert.doesNotMatch(urn, /authoring/);
        assert.doesNotMatch(urn, /reviewing/);
        assert.doesNotMatch(urn, /confirming/);
        assert.doesNotMatch(urn, /::/); // no double-colon phase separator
    });

    // ── Session URN round-trip ──

    it('sessionURN produces deterministic format with phase index', () => {
        assert.equal(sessionURN('n1', 0, 'authoring'), 'urn:squad:session:n1:v0:p0');
        assert.equal(sessionURN('n1', 0, 'confirming'), 'urn:squad:session:n1:v0:p1');
        assert.equal(sessionURN('n1', 5, 'reviewing'), 'urn:squad:session:n1:v5:p2');
    });

    it('fromSessionURN round-trips sessionURN', () => {
        const cases = [
            ['n1', 0, 'authoring'],
            ['node-a', 1, 'confirming'],
            ['__or__', 5, 'reviewing'],
            ['worker-42', 7, 'authoring'],
        ];
        for (const [nodeId, epoch, phase] of cases) {
            const urn = sessionURN(nodeId, epoch, phase);
            const parsed = fromSessionURN(urn);
            assert.equal(parsed.nodeId, nodeId);
            assert.equal(parsed.epoch, epoch);
            assert.equal(parsed.phase, phase);
        }
    });

    it('fromSessionURN throws on malformed session URN', () => {
        assert.throws(() => fromSessionURN(''), /Invalid session URN/);
        assert.throws(() => fromSessionURN('urn:squad:node:n1:v0'), /Invalid session URN/);
        assert.throws(() => fromSessionURN('urn:squad:session:n1:v0'), /Invalid session URN/);
        assert.throws(() => fromSessionURN('urn:squad:session:n1:v0:pX'), /Invalid session URN/);
        assert.throws(() => fromSessionURN('urn:squad:session:n1:v0:p5'), /Unknown phase index/);
    });

    // ── Anti-oscillation ──
    // The system must NEVER manually concatenate ID strings.
    // All URNs must be produced via toURN() / sessionURN().

    it('session URN never contains state words', () => {
        for (const phase of ['authoring', 'confirming', 'reviewing']) {
            const urn = sessionURN('n1', 0, phase);
            assert.doesNotMatch(urn, /authoring/);
            assert.doesNotMatch(urn, /reviewing/);
            assert.doesNotMatch(urn, /confirming/);
            assert.doesNotMatch(urn, /::/);
        }
    });

    it('phase index matches PHASES order: authoring=0, confirming=1, reviewing=2', () => {
        assert.equal(fromSessionURN('urn:squad:session:n1:v0:p0').phase, 'authoring');
        assert.equal(fromSessionURN('urn:squad:session:n1:v0:p1').phase, 'confirming');
        assert.equal(fromSessionURN('urn:squad:session:n1:v0:p2').phase, 'reviewing');
    });

    it('epoch is integral — no floating point or string in output', () => {
        const cases = [0, 1, 2, 5, 100];
        for (const ep of cases) {
            const urn = sessionURN('n1', ep, 'authoring');
            const parsed = fromSessionURN(urn);
            assert.equal(parsed.epoch, ep);
            assert.equal(typeof parsed.epoch, 'number');
        }
    });

    it('nodeId with colon produces unparseable URN (colon is field delimiter)', () => {
        // ':' is the URN field separator. sessionURN() accepts any nodeId but
        // produces a URN that fromSessionURN() cannot parse because the colon
        // in nodeId breaks the field structure.
        const urn = sessionURN('n1:sub', 0, 'authoring');
        // urn is 'urn:squad:session:n1:sub:v0:p0' — syntactically well-formed
        // but the ':' in nodeId 'n1:sub' makes it unparseable.
        assert.throws(() => fromSessionURN(urn), /Invalid session URN/);
    });

    // ── URN backtracking ──
    // Given a URN string, we must be able to derive its semantic components.

    it('fromSessionURN derives nodeId, epoch, phase from any valid session URN', () => {
        const testUrns = [
            { urn: 'urn:squad:session:worker-1:v0:p0', expected: { nodeId: 'worker-1', epoch: 0, phase: 'authoring' } },
            { urn: 'urn:squad:session:or:v3:p1', expected: { nodeId: 'or', epoch: 3, phase: 'confirming' } },
            {
                urn: 'urn:squad:session:reviewer42:v7:p2',
                expected: { nodeId: 'reviewer42', epoch: 7, phase: 'reviewing' },
            },
        ];
        for (const { urn, expected } of testUrns) {
            assert.deepEqual(fromSessionURN(urn), { ...expected, phaseIndex: fromSessionURN(urn).phaseIndex });
        }
    });

    it('fromURN used in reactor test — node-level URN must never be confused with sessionURN', () => {
        // Node URN: urn:squad:node:{nodeId}:v{epoch}
        // Session URN: urn:squad:session:{nodeId}:v{epoch}:p{phaseIndex}
        // These two must NEVER collide. fromURN MUST reject session URNs.
        assert.throws(
            () => fromURN('urn:squad:session:n1:v0:p0'),
            /Invalid URN/,
            'fromURN must reject session URN format',
        );
        assert.throws(
            () => fromSessionURN('urn:squad:node:n1:v0'),
            /Invalid session URN/,
            'fromSessionURN must reject node URN format',
        );
    });
});
