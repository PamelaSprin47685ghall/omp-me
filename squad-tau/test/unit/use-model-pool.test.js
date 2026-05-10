import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import '../../test/helpers/happy-dom.js';
import { useModelPool } from '../../client/hooks/useModelPool.js';
import { renderHook, act } from '@testing-library/react';

test('initial state', () => {
    const { result } = renderHook(() => useModelPool());
    assert.deepEqual(result.current.slots, []);
    assert.equal(result.current.isOpen, false);
});

test('model_pool:snapshot sets slots', () => {
    const { result } = renderHook(() => useModelPool());
    const slots = [{ provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: false }];
    act(() => {
        result.current.dispatch({ type: 'model_pool:snapshot', payload: { slots } });
    });
    assert.deepEqual(result.current.slots, slots);
});

test('model_pool:changed updates slots', () => {
    const { result } = renderHook(() => useModelPool());
    const initial = [{ provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: false }];
    act(() => {
        result.current.dispatch({ type: 'model_pool:snapshot', payload: { slots: initial } });
    });
    const updated = [
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: true },
        { provider: 'anthropic', modelId: 'claude-3-5-haiku', role: 'reviewer', inUse: false },
    ];
    act(() => {
        result.current.dispatch({ type: 'model_pool:changed', payload: { slots: updated } });
    });
    assert.deepEqual(result.current.slots, updated);
});

test('openDrawer sets isOpen to true', () => {
    const { result } = renderHook(() => useModelPool());
    act(() => {
        result.current.openDrawer();
    });
    assert.equal(result.current.isOpen, true);
});

test('closeDrawer sets isOpen to false', () => {
    const { result } = renderHook(() => useModelPool());
    act(() => {
        result.current.openDrawer();
    });
    act(() => {
        result.current.closeDrawer();
    });
    assert.equal(result.current.isOpen, false);
});

test('updateSlot sends message via wired send callback', () => {
    const { result } = renderHook(() => useModelPool());
    const sent = [];
    const mockSend = (msg) => sent.push(msg);

    act(() => {
        result.current.sendModelPoolUpdate(mockSend);
    });

    const slot = { provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker' };
    act(() => {
        result.current.updateSlot('add', slot);
    });

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], {
        type: 'model_pool:update',
        payload: { action: 'add', slot, index: undefined },
    });
});

test('updateSlot with index', () => {
    const { result } = renderHook(() => useModelPool());
    const sent = [];
    const mockSend = (msg) => sent.push(msg);

    act(() => {
        result.current.sendModelPoolUpdate(mockSend);
    });

    const slot = { provider: 'anthropic', modelId: 'claude-3-5-haiku', role: 'reviewer' };
    act(() => {
        result.current.updateSlot('edit', slot, 1);
    });

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], {
        type: 'model_pool:update',
        payload: { action: 'edit', slot, index: 1 },
    });
});

test('updateSlot warns when send not wired', () => {
    const { result } = renderHook(() => useModelPool());
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);

    act(() => {
        result.current.updateSlot('remove', null, 0);
    });

    console.warn = originalWarn;
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /WebSocket send not wired/);
});

test('sendModelPoolUpdate can be called multiple times', () => {
    const { result } = renderHook(() => useModelPool());
    const sent1 = [];
    const sent2 = [];

    act(() => {
        result.current.sendModelPoolUpdate((msg) => sent1.push(msg));
    });

    act(() => {
        result.current.updateSlot('add', { provider: 'anthropic', modelId: 'test', role: 'worker' });
    });

    act(() => {
        result.current.sendModelPoolUpdate((msg) => sent2.push(msg));
    });

    act(() => {
        result.current.updateSlot('remove', null, 0);
    });

    assert.equal(sent1.length, 1);
    assert.equal(sent2.length, 1);
    assert.equal(sent1[0].payload.action, 'add');
    assert.equal(sent2[0].payload.action, 'remove');
});
