/**
 * Shim: @mariozechner/pi-tui — re-exports oh-my-pi's TUI components
 * from the global install location.
 */

import { join } from 'node:path';
import { getPiBase } from '@oh-my-pi/resolve-pi';

const TUI_PATH = join(getPiBase(), 'pi-tui/src/index.ts');
const AGENT_PATH = join(getPiBase(), 'pi-coding-agent/src/modes/theme/theme.ts');

const _mod = await import('file://' + TUI_PATH);
const _agentMod = await import('file://' + AGENT_PATH);

export const Container = _mod.Container;
export const Spacer = _mod.Spacer;
export const Text = _mod.Text;
export const SettingsList = _mod.SettingsList;
const ELLIPSIS = _mod.Ellipsis;
export const Ellipsis = ELLIPSIS;

export const truncateToWidth = (text, maxWidth, ellipsisChar, pad) => {
    if (typeof ellipsisChar === 'string') {
        ellipsisChar = ellipsisChar === '' ? ELLIPSIS.Omit : ELLIPSIS.Unicode;
    }
    return _mod.truncateToWidth(text, maxWidth, ellipsisChar ?? null, pad ?? false);
};
export const visibleWidth = _mod.visibleWidth;
export const Box = _mod.Box;
export const getSettingsListTheme = _agentMod.getSettingsListTheme;

const OrigSelectList = _mod.SelectList;
const DEFAULT_CURSOR = '> ';

function ensureThemeSymbols(theme) {
    if (!theme || theme.symbols) return theme;
    return { ...theme, symbols: { cursor: DEFAULT_CURSOR } };
}

export class SelectList extends OrigSelectList {
    constructor(items, maxVisible, theme, layout) {
        super(items, maxVisible, ensureThemeSymbols(theme), layout);
    }
}
