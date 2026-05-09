/**
 * Shim: @mariozechner/pi-tui — re-exports oh-my-pi's TUI components
 * from the global install location.
 */

import { join } from 'node:path';
import { getPiBase } from '@oh-my-pi/resolve-pi';

const TUI_PATH = join(getPiBase(), 'pi-tui/src/index.ts');

const _mod = await import('file://' + TUI_PATH);

export const Container = _mod.Container;
export const Spacer = _mod.Spacer;
export const Text = _mod.Text;

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
