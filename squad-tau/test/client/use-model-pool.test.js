import { test, expect } from 'bun:test';
import '../../test/helpers/happy-dom.js';
import { useModelPool } from '../../client/hooks/useModelPool.js';
import { renderHook, act } from '@testing-library/react';

test('initial state', () => {
    const { result } = renderHook(() => useModelPool());
    expect(result.current.slots).toEqual([]);
    expect(result.current.isOpen).toBe(false);
});

test('model_pool:snapshot sets slots', () => {
    const { result } = renderHook(() => useModelPool());
    const slots = [{ provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: false }];
    act(() => {
        result.current.dispatch({ type: 'model_pool:snapshot', payload: { slots } });
    });
    expect(result.current.slots).toEqual(slots);
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
    expect(result.current.slots).toEqual(updated);
});

test('openDrawer sets isOpen to true', () => {
    const { result } = renderHook(() => useModelPool());
    act(() => {
        result.current.openDrawer();
    });
    expect(result.current.isOpen).toBe(true);
});

test('closeDrawer sets isOpen to false', () => {
    const { result } = renderHook(() => useModelPool());
    act(() => {
        result.current.openDrawer();
    });
    act(() => {
        result.current.closeDrawer();
    });
    expect(result.current.isOpen).toBe(false);
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

    expect(sent.length).toBe(1);
    expect(sent[0]).toEqual({
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

    expect(sent.length).toBe(1);
    expect(sent[0]).toEqual({
        type: 'model_pool:update',
        payload: { action: 'edit', slot, slotId: 1 },
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
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/WebSocket send not wired/);
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

    expect(sent1.length).toBe(1);
    expect(sent2.length).toBe(1);
    expect(sent1[0].payload.action).toBe('add');
    expect(sent2[0].payload.action).toBe('remove');
});
