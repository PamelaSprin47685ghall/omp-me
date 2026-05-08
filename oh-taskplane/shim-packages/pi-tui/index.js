/**
 * Shim: @mariozechner/pi-tui — re-exports oh-my-pi's TUI components
 * from the global install location (AGENTS.md file:// pattern).
 *
 * Same approach as advisor: `homedir()/.bun/install/global/node_modules/...`
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

const TUI_PATH = join(homedir(), '.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/index.ts');

const _mod = await import('file://' + TUI_PATH);

export const Container = _mod.Container;
export const SettingsList = _mod.SettingsList;
export const Text = _mod.Text;
export const truncateToWidth = _mod.truncateToWidth;

/**
 * Wrapped SelectList — fills in `symbols` when the theme lacks it.
 *
 * Some extensions' selectListTheme() returns only style functions without
 * `symbols`, but oh-my-pi's SelectList requires theme.symbols.cursor
 * for rendering the selection cursor marker.
 */
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
