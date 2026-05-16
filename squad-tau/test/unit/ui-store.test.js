import { describe, it, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { eventStore } from '../../client/event-store.js';
import { uiStore } from '../../client/ui-store.js';

describe('UI Store — Anemic State via EventStore', () => {
    beforeEach(() => {
        eventStore.reset();
    });

    it('initial UI state has default values', () => {
        const ui = uiStore.getState();
        assert.equal(ui.sidebarOpen, false);
        assert.equal(ui.viewMode, 'dag');
        assert.equal(ui.activeSessionId, null);
        assert.equal(ui.drawerOpen, false);
        assert.equal(ui.bannerDismissed, false);
    });

    it('ui:toggle_sidebar flips sidebarOpen', () => {
        assert.equal(uiStore.getState().sidebarOpen, false, 'starts closed');
        uiStore.dispatch('ui:toggle_sidebar');
        assert.equal(uiStore.getState().sidebarOpen, true, 'now open');
        uiStore.dispatch('ui:toggle_sidebar');
        assert.equal(uiStore.getState().sidebarOpen, false, 'now closed');
    });

    it('ui:select_session sets activeSessionId and switches to session view', () => {
        uiStore.dispatch('ui:select_session', { sessionId: 'urn:squad:session:n1:v0:p0' });
        const ui = uiStore.getState();
        assert.equal(ui.activeSessionId, 'urn:squad:session:n1:v0:p0');
        assert.equal(ui.viewMode, 'session');
    });

    it('ui:set_view_mode changes view mode', () => {
        uiStore.dispatch('ui:set_view_mode', { viewMode: 'session' });
        assert.equal(uiStore.getState().viewMode, 'session');
        uiStore.dispatch('ui:set_view_mode', { viewMode: 'dag' });
        assert.equal(uiStore.getState().viewMode, 'dag');
    });

    it('ui:toggle_drawer with explicit open value', () => {
        uiStore.dispatch('ui:toggle_drawer', { open: true });
        assert.equal(uiStore.getState().drawerOpen, true);
        uiStore.dispatch('ui:toggle_drawer', { open: false });
        assert.equal(uiStore.getState().drawerOpen, false);
    });

    it('ui:dismiss_banner sets bannerDismissed to true', () => {
        assert.equal(uiStore.getState().bannerDismissed, false);
        uiStore.dispatch('ui:dismiss_banner');
        assert.equal(uiStore.getState().bannerDismissed, true);
    });

    it('subscribe fires on state change', () => {
        let callCount = 0;
        const unsub = uiStore.subscribe(() => callCount++);
        assert.equal(callCount, 0, 'no callback yet');
        uiStore.dispatch('ui:toggle_sidebar');
        assert.equal(callCount, 1, 'callback fired on state change');
        unsub();
        uiStore.dispatch('ui:toggle_sidebar');
        assert.equal(callCount, 1, 'unsubscribed, no more callbacks');
    });

    it('state is immutable — dispatching returns new object ref', () => {
        const before = eventStore.getState();
        uiStore.dispatch('ui:toggle_sidebar');
        const after = eventStore.getState();
        assert.notStrictEqual(after, before, 'new root object');
        assert.strictEqual(after.nodes, before.nodes, 'nodes branch preserved');
    });
});
