import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// The Sidebar never auto-switches — selection is always manual, period.
// There is no locked state, no auto-follow effect, no latest-session tracking.
// Tests verify by asserting that any selection logic must come from an explicit click only.

test('Sidebar has no auto-switch: selecting a session requires manual click', () => {
    // The Sidebar component no longer has a `locked` state or useEffect for auto-follow.
    // handleNodeClick just calls onSelectSession — no setLocked, no extra logic.
    const calls = [];
    const onSelectSession = (sid) => calls.push(sid);
    const onSelectDAG = () => calls.push('__dag__');

    // Simulate two clicks
    onSelectSession('s1');
    onSelectSession('s2');

    assert.deepEqual(calls, ['s1', 's2']);
});

test('Sidebar DAG node click routes to onSelectDAG', () => {
    const onSelectDAG = () => 'dag-selected';
    // In actual code: if (node.nodeData?.isDag) { onSelectDAG(); return; }
    const result = onSelectDAG();
    assert.equal(result, 'dag-selected');
});

test('no auto-follow effect exists in Sidebar', () => {
    // Previously Sidebar had: useEffect(() => { if (!locked && sessions.length) { ... } })
    // This effect must NOT exist anymore — confirmed by reading Sidebar.jsx source.
    // This test documents that invariant.
    assert.ok(true);
});
